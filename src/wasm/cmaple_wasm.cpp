#include "../../vendor/cmaple/maple/cmaple.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <iomanip>
#include <ios>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

enum AlignmentFormat {
  FORMAT_AUTO = 0,
  FORMAT_FASTA = 1,
  FORMAT_PHYLIP = 2,
  FORMAT_MAPLE = 3,
};

struct LoadedAlignment {
  std::unique_ptr<cmaple::Alignment> alignment;
  bool effective;
  unsigned int file_size;
};

struct FilterResult {
  unsigned int removed = 0;
  unsigned int retained = 0;
};

struct SampleQuality {
  double score = 0;
  std::size_t mutation_count = 0;
};

std::unordered_map<unsigned int, LoadedAlignment> loaded_alignments;
unsigned int next_alignment_handle = 1;

class MemoryInputBuffer : public std::streambuf {
 public:
  explicit MemoryInputBuffer(std::string_view input) {
    char* begin = const_cast<char*>(input.data());
    setg(begin, begin, begin + input.size());
  }

 protected:
  pos_type seekoff(off_type offset,
                   std::ios_base::seekdir direction,
                   std::ios_base::openmode mode) override {
    if ((mode & std::ios_base::in) == 0) {
      return pos_type(off_type(-1));
    }

    char* base = eback();
    char* next = gptr();
    char* end = egptr();
    off_type absolute = 0;

    switch (direction) {
      case std::ios_base::beg:
        absolute = offset;
        break;
      case std::ios_base::cur:
        absolute = (next - base) + offset;
        break;
      case std::ios_base::end:
        absolute = (end - base) + offset;
        break;
      default:
        return pos_type(off_type(-1));
    }

    if (absolute < 0 || absolute > (end - base)) {
      return pos_type(off_type(-1));
    }

    setg(base, base + absolute, end);
    return pos_type(absolute);
  }

  pos_type seekpos(pos_type position,
                   std::ios_base::openmode mode) override {
    return seekoff(off_type(position), std::ios_base::beg, mode);
  }
};

cmaple::Alignment::InputType toCmapleFormat(int format) {
  switch (format) {
    case FORMAT_FASTA:
      return cmaple::Alignment::IN_FASTA;
    case FORMAT_PHYLIP:
      return cmaple::Alignment::IN_PHYLIP;
    case FORMAT_MAPLE:
      return cmaple::Alignment::IN_MAPLE;
    case FORMAT_AUTO:
    default:
      return cmaple::Alignment::IN_AUTO;
  }
}

std::string_view trimAlignmentBytes(const unsigned char* data, unsigned int size) {
  std::string_view view(reinterpret_cast<const char*>(data), size);

  if (view.size() >= 3 &&
      static_cast<unsigned char>(view[0]) == 0xef &&
      static_cast<unsigned char>(view[1]) == 0xbb &&
      static_cast<unsigned char>(view[2]) == 0xbf) {
    view.remove_prefix(3);
  }

  while (!view.empty() && static_cast<unsigned char>(view.front()) <= 32) {
    view.remove_prefix(1);
  }

  return view;
}

std::size_t countFastaHeaders(std::string_view input) {
  std::size_t count = 0;
  bool at_line_start = true;

  for (const char ch : input) {
    if (at_line_start && ch == '>') {
      ++count;
    }
    at_line_start = ch == '\n' || ch == '\r';
  }

  return count;
}

std::string jsonEscape(const std::string& input) {
  std::ostringstream out;
  for (const unsigned char c : input) {
    switch (c) {
      case '\\':
        out << "\\\\";
        break;
      case '"':
        out << "\\\"";
        break;
      case '\b':
        out << "\\b";
        break;
      case '\f':
        out << "\\f";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        if (c < 0x20) {
          out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
              << static_cast<int>(c);
        } else {
          out << c;
        }
    }
  }
  return out.str();
}

char* copyResult(const std::string& result) {
  char* buffer = static_cast<char*>(std::malloc(result.size() + 1));
  if (buffer == nullptr) {
    return nullptr;
  }
  std::memcpy(buffer, result.c_str(), result.size() + 1);
  return buffer;
}

std::string errorJson(const std::string& message) {
  return "{\"type\":\"error\",\"error\":\"" + jsonEscape(message) + "\"}";
}

std::string formatName(cmaple::Alignment::InputType format) {
  switch (format) {
    case cmaple::Alignment::IN_FASTA:
      return "fasta";
    case cmaple::Alignment::IN_PHYLIP:
      return "phylip";
    case cmaple::Alignment::IN_MAPLE:
      return "maple";
    case cmaple::Alignment::IN_AUTO:
      return "auto";
    case cmaple::Alignment::IN_UNKNOWN:
    default:
      return "auto";
  }
}

double sequenceQualityScore(const cmaple::Sequence& sequence,
                            const unsigned int sequence_length) {
  if (!sequence_length) return 0;

  double impacted_sites = 0;
  for (const auto& mutation : sequence) {
    impacted_sites += mutation.getLength();
  }

  return impacted_sites / sequence_length;
}

std::vector<SampleQuality> getSortedSampleQuality(const cmaple::Alignment& alignment) {
  std::vector<SampleQuality> samples;
  samples.reserve(alignment.data.size());

  const unsigned int sequence_length = alignment.ref_seq.size();
  for (const auto& sequence : alignment.data) {
    samples.push_back({
        sequenceQualityScore(sequence, sequence_length),
        sequence.size(),
    });
  }

  std::sort(samples.begin(), samples.end(), [](const SampleQuality& left,
                                               const SampleQuality& right) {
    return left.score < right.score;
  });
  return samples;
}

void appendDivergenceSummary(std::ostringstream& out,
                             const cmaple::Alignment& alignment) {
  const std::vector<SampleQuality> samples = getSortedSampleQuality(alignment);
  const double max_score = samples.empty() ? 0 : samples.back().score * 100;

  out << ",\"divergence\":{"
      << "\"sampleScores\":[";

  for (std::size_t index = 0; index < samples.size(); ++index) {
    if (index > 0) out << ",";
    out << std::setprecision(6) << samples[index].score * 100;
  }

  out << "],\"cmapleMutationCounts\":[";

  for (std::size_t index = 0; index < samples.size(); ++index) {
    if (index > 0) out << ",";
    out << samples[index].mutation_count;
  }

  out << "],\"maxScore\":" << std::setprecision(6) << max_score << "}";
}

class ScopedAlignmentQualityFilter {
 public:
  ScopedAlignmentQualityFilter(cmaple::Alignment& alignment,
                               const double max_score_percent)
      : alignment_(alignment) {
    const double max_score = max_score_percent / 100.0;
    const unsigned int sequence_length = alignment_.ref_seq.size();
    original_data_ = std::move(alignment_.data);
    retained_mask_.reserve(original_data_.size());
    alignment_.data.reserve(original_data_.size());

    for (auto& sequence : original_data_) {
      const bool retained =
          sequenceQualityScore(sequence, sequence_length) <= max_score;
      retained_mask_.push_back(retained);
      if (retained) {
        alignment_.data.push_back(std::move(sequence));
      } else {
        ++result.removed;
      }
    }

    result.retained = static_cast<unsigned int>(alignment_.data.size());
  }

  ~ScopedAlignmentQualityFilter() {
    std::vector<cmaple::Sequence> restored;
    restored.reserve(retained_mask_.size());

    std::size_t retained_index = 0;
    for (std::size_t index = 0; index < retained_mask_.size(); ++index) {
      if (retained_mask_[index]) {
        restored.push_back(std::move(alignment_.data[retained_index]));
        ++retained_index;
      } else {
        restored.push_back(std::move(original_data_[index]));
      }
    }

    alignment_.data = std::move(restored);
  }

  FilterResult result;

 private:
  cmaple::Alignment& alignment_;
  std::vector<cmaple::Sequence> original_data_;
  std::vector<bool> retained_mask_;
};

std::string preflightJson(const cmaple::Alignment& alignment,
                          const unsigned int file_size,
                          const bool effective,
                          const unsigned int handle) {
  std::ostringstream out;
  out << "{\"type\":\"preflight\","
      << "\"id\":\"\","
      << "\"handle\":" << handle << ","
      << "\"stats\":{"
      << "\"fileName\":\"\","
      << "\"fileSize\":" << file_size << ","
      << "\"format\":\"" << formatName(alignment.aln_format) << "\","
      << "\"sequenceCount\":" << alignment.data.size() << ","
      << "\"sequenceLength\":" << alignment.ref_seq.size()
      << "},"
      << "\"effective\":" << (effective ? "true" : "false");
  appendDivergenceSummary(out, alignment);
  out << ",\"warnings\":[]}";
  return out.str();
}

std::string resultJson(const std::string& newick,
                       const double log_likelihood,
                       const bool effective,
                       const unsigned int removed_samples) {
  std::ostringstream out;
  out << "{\"type\":\"result\","
      << "\"id\":\"\","
      << "\"newick\":\"" << jsonEscape(newick) << "\","
      << "\"logLikelihood\":" << std::setprecision(17) << log_likelihood
      << ",\"effective\":" << (effective ? "true" : "false");

  if (removed_samples > 0) {
    out << ",\"warnings\":[\"Removed " << removed_samples
        << " sample" << (removed_samples == 1 ? "" : "s")
        << " above the divergence/quality threshold.\"]}";
  } else {
    out << ",\"warnings\":[]}";
  }

  return out.str();
}

std::string inferAlignment(cmaple::Alignment& alignment,
                           int num_threads,
                           int compute_branch_support,
                           int branch_support_replicates,
                           int filter_divergent_samples,
                           double max_divergence_percent) {
  unsigned int removed_samples = 0;
  std::unique_ptr<ScopedAlignmentQualityFilter> scoped_filter;

  if (filter_divergent_samples) {
    if (max_divergence_percent < 0) max_divergence_percent = 0;
    scoped_filter = std::make_unique<ScopedAlignmentQualityFilter>(
        alignment, max_divergence_percent);
    const FilterResult filter_result = scoped_filter->result;
    removed_samples = filter_result.removed;

    if (filter_result.retained < 3) {
      std::ostringstream message;
      message << "The divergence/quality filter would leave "
              << filter_result.retained
              << " sample" << (filter_result.retained == 1 ? "" : "s")
              << ". CMAPLE requires at least 3 samples. Increase the threshold or turn filtering off.";
      return errorJson(message.str());
    }

    std::cout << "Divergence / quality filter: retained "
              << filter_result.retained << " of "
              << (filter_result.retained + filter_result.removed)
              << " samples";
    if (filter_result.removed > 0) {
      std::cout << " (" << filter_result.removed << " removed)";
    }
    std::cout << std::endl;
  } else {
    std::cout << "Divergence / quality filter: off" << std::endl;
  }

  const bool effective = cmaple::isEffective(alignment);
  cmaple::Model model(cmaple::ModelBase::GTR, cmaple::SeqRegion::SEQ_DNA);
  cmaple::Tree tree(&alignment, &model);

  tree.infer(num_threads, cmaple::Tree::NORMAL_TREE_SEARCH, false, false);
  if (compute_branch_support && branch_support_replicates > 0) {
    tree.computeBranchSupport(num_threads, branch_support_replicates);
  }

  const double log_likelihood = tree.computeLh();
  const std::string newick =
      tree.exportNewick(cmaple::Tree::BIN_TREE, false, true);

  return resultJson(newick, log_likelihood, effective, removed_samples);
}

std::unique_ptr<cmaple::Alignment> parseAlignment(const unsigned char* data,
                                                  const unsigned int size,
                                                  int format) {
  std::string_view alignment_text = trimAlignmentBytes(data, size);
  if (alignment_text.size() >= 2 &&
      static_cast<unsigned char>(alignment_text[0]) == 0x1f &&
      static_cast<unsigned char>(alignment_text[1]) == 0x8b) {
    throw std::invalid_argument(
        "Compressed .gz input is not supported in the browser build. Please upload a plain text FASTA, PHYLIP, or MAPLE file.");
  }
  if (format == FORMAT_AUTO && !alignment_text.empty() &&
      alignment_text.front() == '>') {
    format = FORMAT_FASTA;
  }

  const std::size_t fasta_headers = countFastaHeaders(alignment_text);
  if (toCmapleFormat(format) == cmaple::Alignment::IN_FASTA &&
      fasta_headers > 0 && fasta_headers < 3) {
    std::ostringstream message;
    message << "FASTA input contains " << fasta_headers
            << " sequence" << (fasta_headers == 1 ? "" : "s")
            << ". CMAPLE requires at least 3 sequences.";
    throw std::invalid_argument(message.str());
  }

  MemoryInputBuffer alignment_buffer(alignment_text);
  std::istream alignment_stream(&alignment_buffer);
  return std::make_unique<cmaple::Alignment>(
      alignment_stream,
      "",
      toCmapleFormat(format),
      cmaple::SeqRegion::SEQ_DNA);
}

}  // namespace

void normalizeNumThreads(int& num_threads) {
  if (num_threads < 1) {
    num_threads = 1;
  }
#if !defined(_OPENMP)
  if (num_threads != 1) {
    std::cout << "CMAPLE OpenMP is unavailable in this WebAssembly build; using 1 thread."
              << std::endl;
    num_threads = 1;
  }
#endif
}

void normalizeBranchSupportReplicates(int& branch_support_replicates) {
  if (branch_support_replicates < 1) {
    branch_support_replicates = 0;
  }
}

namespace cmaple {

std::string getVersion() {
  return "CMAPLE 2.0.0";
}

std::string getCitations() {
  return "Nhan Ly-Trong, Chris Bielow, Nicola De Maio, Bui Quang Minh (2024) "
         "CMAPLE: Efficient phylogenetic inference in the pandemic era.";
}

bool isEffective(const Alignment& alignment,
                 const double max_subs_per_site,
                 const double mean_subs_per_site) {
  const auto seq_length = alignment.ref_seq.size();
  const auto num_sequences = alignment.data.size();
  if (!seq_length) {
    throw std::invalid_argument("Empty reference genome!");
  }
  if (num_sequences < 3) {
    throw std::invalid_argument(
        "Empty alignment or the number of sequences is less than 3!");
  }
  if (max_subs_per_site < mean_subs_per_site) {
    throw std::invalid_argument(
        "max_subs_per_site must not be fewer than mean_subs_per_site!");
  }

  const auto max_mutations = seq_length * max_subs_per_site;
  auto max_sum_mutations = seq_length * mean_subs_per_site * num_sequences;

  for (const Sequence& sequence : alignment.data) {
    if (sequence.size() > max_mutations) {
      return false;
    }
    max_sum_mutations -= sequence.size();
    if (max_sum_mutations < 0) {
      return false;
    }
  }

  return true;
}

}  // namespace cmaple

extern "C" void* cmaple_alloc(unsigned int size) {
  return std::malloc(size);
}

extern "C" void cmaple_free(void* ptr) {
  std::free(ptr);
}

extern "C" void cmaple_release(unsigned int handle) {
  loaded_alignments.erase(handle);
}

#if defined(__wasi__)
extern "C" void* __cxa_allocate_exception(unsigned long size) {
  return std::malloc(size);
}

extern "C" void __cxa_free_exception(void* thrown_exception) {
  std::free(thrown_exception);
}

extern "C" [[noreturn]] void __cxa_throw(void*, void*, void*) {
  std::abort();
}
#endif

extern "C" char* cmaple_infer(const unsigned char* data,
                               unsigned int size,
                               int format,
                               int num_threads,
                               int compute_branch_support,
                               int branch_support_replicates,
                               int filter_divergent_samples,
                               double max_divergence_percent) {
  try {
    if (data == nullptr || size == 0) {
      return copyResult(errorJson("Alignment file is empty."));
    }

    normalizeNumThreads(num_threads);
    normalizeBranchSupportReplicates(branch_support_replicates);

    cmaple::verbose_mode = cmaple::VB_MED;

    auto alignment = parseAlignment(data, size, format);
    return copyResult(inferAlignment(*alignment,
                                     num_threads,
                                     compute_branch_support,
                                     branch_support_replicates,
                                     filter_divergent_samples,
                                     max_divergence_percent));
  } catch (const std::exception& err) {
    return copyResult(errorJson(err.what()));
  } catch (...) {
    return copyResult(errorJson("CMAPLE failed with an unknown error."));
  }
}

extern "C" char* cmaple_analyze(const unsigned char* data,
                                 unsigned int size,
                                 int format) {
  try {
    if (data == nullptr || size == 0) {
      return copyResult(errorJson("Alignment file is empty."));
    }

    cmaple::verbose_mode = cmaple::VB_QUIET;
    auto alignment = parseAlignment(data, size, format);
    const bool effective = cmaple::isEffective(*alignment);
    const unsigned int handle = next_alignment_handle++;
    LoadedAlignment loaded{
        std::move(alignment),
        effective,
        size,
    };
    const cmaple::Alignment& stored_alignment = *loaded.alignment;
    loaded_alignments.emplace(handle, std::move(loaded));
    return copyResult(preflightJson(stored_alignment, size, effective, handle));
  } catch (const std::exception& err) {
    return copyResult(errorJson(err.what()));
  } catch (...) {
    return copyResult(errorJson("CMAPLE preflight failed with an unknown error."));
  }
}

extern "C" char* cmaple_infer_loaded(unsigned int handle,
                                      int num_threads,
                                      int compute_branch_support,
                                      int branch_support_replicates,
                                      int filter_divergent_samples,
                                      double max_divergence_percent) {
  try {
    auto loaded = loaded_alignments.find(handle);
    if (loaded == loaded_alignments.end()) {
      return copyResult(errorJson(
          "The parsed alignment is no longer loaded. Drop the file again."));
    }

    normalizeNumThreads(num_threads);
    normalizeBranchSupportReplicates(branch_support_replicates);
    cmaple::verbose_mode = cmaple::VB_MED;

    cmaple::Alignment& alignment = *loaded->second.alignment;
    return copyResult(inferAlignment(alignment,
                                     num_threads,
                                     compute_branch_support,
                                     branch_support_replicates,
                                     filter_divergent_samples,
                                     max_divergence_percent));
  } catch (const std::exception& err) {
    return copyResult(errorJson(err.what()));
  } catch (...) {
    return copyResult(errorJson("CMAPLE failed with an unknown error."));
  }
}
