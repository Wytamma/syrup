#include "../../vendor/cmaple/maple/cmaple.h"

#include <algorithm>
#include <cctype>
#include <chrono>
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

enum BranchSupportMethod {
  BRANCH_SUPPORT_NONE = 0,
  BRANCH_SUPPORT_SPRTA = 1,
  BRANCH_SUPPORT_SH_ALRT = 2,
};

enum SubstitutionModel {
  SUBSTITUTION_MODEL_GTR = 0,
  SUBSTITUTION_MODEL_JC = 1,
  SUBSTITUTION_MODEL_UNREST = 2,
  SUBSTITUTION_MODEL_GTR20 = 3,
  SUBSTITUTION_MODEL_NONREV = 4,
  SUBSTITUTION_MODEL_LG = 5,
  SUBSTITUTION_MODEL_WAG = 6,
  SUBSTITUTION_MODEL_JTT = 7,
  SUBSTITUTION_MODEL_Q_PFAM = 8,
  SUBSTITUTION_MODEL_Q_BIRD = 9,
  SUBSTITUTION_MODEL_Q_MAMMAL = 10,
  SUBSTITUTION_MODEL_Q_INSECT = 11,
  SUBSTITUTION_MODEL_Q_PLANT = 12,
  SUBSTITUTION_MODEL_Q_YEAST = 13,
  SUBSTITUTION_MODEL_JTTDCMUT = 14,
  SUBSTITUTION_MODEL_DCMUT = 15,
  SUBSTITUTION_MODEL_VT = 16,
  SUBSTITUTION_MODEL_PMB = 17,
  SUBSTITUTION_MODEL_BLOSUM62 = 18,
  SUBSTITUTION_MODEL_DAYHOFF = 19,
  SUBSTITUTION_MODEL_MTREV = 20,
  SUBSTITUTION_MODEL_MTART = 21,
  SUBSTITUTION_MODEL_MTZOA = 22,
  SUBSTITUTION_MODEL_MTMET = 23,
  SUBSTITUTION_MODEL_MTVER = 24,
  SUBSTITUTION_MODEL_MTINV = 25,
  SUBSTITUTION_MODEL_MTMAM = 26,
  SUBSTITUTION_MODEL_FLAVI = 27,
  SUBSTITUTION_MODEL_HIVB = 28,
  SUBSTITUTION_MODEL_HIVW = 29,
  SUBSTITUTION_MODEL_FLU = 30,
  SUBSTITUTION_MODEL_RTREV = 31,
  SUBSTITUTION_MODEL_CPREV = 32,
  SUBSTITUTION_MODEL_NQ_PFAM = 33,
  SUBSTITUTION_MODEL_NQ_BIRD = 34,
  SUBSTITUTION_MODEL_NQ_MAMMAL = 35,
  SUBSTITUTION_MODEL_NQ_INSECT = 36,
  SUBSTITUTION_MODEL_NQ_PLANT = 37,
  SUBSTITUTION_MODEL_NQ_YEAST = 38,
};

enum TreeSearchMode {
  TREE_SEARCH_FAST = 0,
  TREE_SEARCH_NORMAL = 1,
  TREE_SEARCH_EXHAUSTIVE = 2,
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

struct WarningSummary {
  bool filter_divergent_samples = false;
  double max_divergence_percent = 0;
  unsigned int constant_a = 0;
  unsigned int constant_c = 0;
  unsigned int constant_g = 0;
  unsigned int constant_t = 0;
  unsigned int sequence_count = 0;
  unsigned int removed_count = 0;
  unsigned int sequence_length = 0;
  unsigned int variable_columns = 0;
  double mean_ambiguous_sites = 0;
  double ambiguous_fraction = 0;
};

struct ConstantSiteCounts {
  unsigned int a = 0;
  unsigned int c = 0;
  unsigned int g = 0;
  unsigned int t = 0;
};

std::unordered_map<unsigned int, LoadedAlignment> loaded_alignments;
unsigned int next_alignment_handle = 1;

double nowMs() {
#if defined(CMAPLE_WASM_PROFILE_LOGS)
  using Clock = std::chrono::steady_clock;
  static const auto start = Clock::now();
  const auto elapsed = Clock::now() - start;
  return std::chrono::duration<double, std::milli>(elapsed).count();
#else
  return 0;
#endif
}

void profileLog(const std::string& phase, const double elapsed_ms) {
#if defined(CMAPLE_WASM_PROFILE_LOGS)
  std::cout << "[CMAPLE profile] " << phase << "Ms="
            << std::fixed << std::setprecision(1) << elapsed_ms << std::endl;
#else
  (void)phase;
  (void)elapsed_ms;
#endif
}

cmaple::VerboseMode inferenceVerboseMode() {
#if defined(CMAPLE_WASM_PROFILE_LOGS)
  return cmaple::VB_MAX;
#else
  return cmaple::VB_MED;
#endif
}

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

std::string sequenceTypeName(cmaple::SeqRegion::SeqType sequence_type) {
  switch (sequence_type) {
    case cmaple::SeqRegion::SEQ_PROTEIN:
      return "protein";
    case cmaple::SeqRegion::SEQ_DNA:
    case cmaple::SeqRegion::SEQ_AUTO:
    case cmaple::SeqRegion::SEQ_UNKNOWN:
    default:
      return "dna";
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

std::size_t concreteStateCount(const cmaple::Alignment& alignment) {
  return alignment.getSeqType() == cmaple::SeqRegion::SEQ_PROTEIN ? 20 : 4;
}

bool isConcreteState(const cmaple::Alignment& alignment,
                     const cmaple::StateType state) {
  return state < concreteStateCount(alignment);
}

unsigned int totalConstantSites(const ConstantSiteCounts& counts) {
  return counts.a + counts.c + counts.g + counts.t;
}

std::size_t mutationLength(const cmaple::Mutation& mutation,
                           const unsigned int sequence_length) {
  if (mutation.position >= sequence_length) return 0;
  return std::min<std::size_t>(
      mutation.getLength(),
      static_cast<std::size_t>(sequence_length - mutation.position));
}

void appendReferenceState(std::vector<cmaple::StateType>& ref_seq,
                          const cmaple::StateType state,
                          const unsigned int count) {
  ref_seq.insert(ref_seq.end(), count, state);
}

class ScopedConstantSites {
 public:
  ScopedConstantSites(cmaple::Alignment& alignment,
                      const ConstantSiteCounts& counts)
      : alignment_(alignment),
        counts_(counts),
        original_ref_length_(alignment.ref_seq.size()),
        applied_(false) {
    apply();
  }

  void apply() {
    if (applied_ || totalConstantSites(counts_) == 0) return;

    // For CMAPLE's reference-plus-mutations representation, constant columns
    // are represented by extending the reference. Per-sample mutations remain
    // unchanged because every sample matches these added reference positions.
    appendReferenceState(alignment_.ref_seq, 0, counts_.a);
    appendReferenceState(alignment_.ref_seq, 1, counts_.c);
    appendReferenceState(alignment_.ref_seq, 2, counts_.g);
    appendReferenceState(alignment_.ref_seq, 3, counts_.t);
    applied_ = true;
  }

  void restore() {
    if (!applied_) return;
    alignment_.ref_seq.resize(original_ref_length_);
    applied_ = false;
  }

  ~ScopedConstantSites() {
    restore();
  }

  bool applied() const {
    return applied_;
  }

 private:
  cmaple::Alignment& alignment_;
  ConstantSiteCounts counts_;
  std::size_t original_ref_length_;
  bool applied_;
};

cmaple::StateType stateAtReferencePosition(const cmaple::Alignment& alignment,
                                           const unsigned int position) {
  return position < alignment.ref_seq.size()
      ? alignment.ref_seq[position]
      : cmaple::TYPE_N;
}

WarningSummary getWarningSummary(const cmaple::Alignment& alignment,
                                 const bool filter_divergent_samples,
                                 double max_divergence_percent,
                                 const ConstantSiteCounts& constant_sites) {
  if (max_divergence_percent < 0) max_divergence_percent = 0;

  WarningSummary summary;
  summary.filter_divergent_samples = filter_divergent_samples;
  summary.max_divergence_percent = max_divergence_percent;
  summary.constant_a = constant_sites.a;
  summary.constant_c = constant_sites.c;
  summary.constant_g = constant_sites.g;
  summary.constant_t = constant_sites.t;
  summary.sequence_length = static_cast<unsigned int>(alignment.ref_seq.size());

  if (summary.sequence_length == 0) return summary;

  const double max_score = max_divergence_percent / 100.0;
  const std::size_t state_count = concreteStateCount(alignment);
  std::vector<unsigned int> base_counts(summary.sequence_length * state_count, 0);
  double ambiguous_sites = 0;

  for (const auto& sequence : alignment.data) {
    const bool retained = !filter_divergent_samples ||
        sequenceQualityScore(sequence, summary.sequence_length) <= max_score;

    if (!retained) {
      ++summary.removed_count;
      continue;
    }

    ++summary.sequence_count;

    for (unsigned int position = 0; position < summary.sequence_length; ++position) {
      const cmaple::StateType ref_state = stateAtReferencePosition(alignment, position);
      if (isConcreteState(alignment, ref_state)) {
        ++base_counts[position * state_count + ref_state];
      } else {
        ++ambiguous_sites;
      }
    }

    for (const auto& mutation : sequence) {
      const std::size_t length = mutationLength(mutation, summary.sequence_length);
      if (length == 0) continue;

      for (std::size_t offset = 0; offset < length; ++offset) {
        const unsigned int position = mutation.position + offset;
        const cmaple::StateType ref_state = stateAtReferencePosition(alignment, position);
        if (isConcreteState(alignment, ref_state)) {
          unsigned int& ref_count = base_counts[position * state_count + ref_state];
          if (ref_count > 0) --ref_count;
        } else if (ambiguous_sites > 0) {
          --ambiguous_sites;
        }

        if (isConcreteState(alignment, mutation.type)) {
          ++base_counts[position * state_count + mutation.type];
        } else {
          ++ambiguous_sites;
        }
      }
    }
  }

  for (unsigned int position = 0; position < summary.sequence_length; ++position) {
    unsigned int concrete_states = 0;
    for (std::size_t state = 0; state < state_count; ++state) {
      if (base_counts[position * state_count + state] > 0) {
        ++concrete_states;
      }
    }
    if (concrete_states > 1) {
      ++summary.variable_columns;
    }
  }

  if (summary.sequence_count > 0) {
    summary.mean_ambiguous_sites = ambiguous_sites / summary.sequence_count;
    summary.ambiguous_fraction =
        ambiguous_sites / (summary.sequence_count * summary.sequence_length);
  }

  return summary;
}

void appendWarningSummary(std::ostringstream& out,
                          const WarningSummary& summary) {
  out << "\"filterDivergentSamples\":"
      << (summary.filter_divergent_samples ? "true" : "false")
      << ",\"maxDivergencePercent\":" << std::setprecision(6)
      << summary.max_divergence_percent
      << ",\"constantSites\":{"
      << "\"a\":" << summary.constant_a
      << ",\"c\":" << summary.constant_c
      << ",\"g\":" << summary.constant_g
      << ",\"t\":" << summary.constant_t
      << "}"
      << ",\"sequenceCount\":" << summary.sequence_count
      << ",\"removedCount\":" << summary.removed_count
      << ",\"sequenceLength\":" << summary.sequence_length
      << ",\"variableColumns\":" << summary.variable_columns
      << ",\"meanAmbiguousSites\":" << std::setprecision(6)
      << summary.mean_ambiguous_sites
      << ",\"ambiguousFraction\":" << std::setprecision(6)
      << summary.ambiguous_fraction;
}

std::string warningSummaryJson(const cmaple::Alignment& alignment,
                               const bool filter_divergent_samples,
                               const double max_divergence_percent,
                               const ConstantSiteCounts& constant_sites) {
  std::ostringstream out;
  out << "{\"type\":\"warning-summary\","
      << "\"id\":\"\","
      << "\"warningSummary\":{";
  appendWarningSummary(
      out,
      getWarningSummary(alignment,
                        filter_divergent_samples,
                        max_divergence_percent,
                        constant_sites));
  out << "}}";
  return out.str();
}

std::string mapleExportJson(cmaple::Alignment& alignment) {
  std::ostringstream maple;
  alignment.write(maple, cmaple::Alignment::IN_MAPLE);

  std::ostringstream out;
  out << "{\"type\":\"maple-export\","
      << "\"id\":\"\","
      << "\"maple\":\"" << jsonEscape(maple.str()) << "\"}";
  return out.str();
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
      << "\"sequenceType\":\"" << sequenceTypeName(alignment.getSeqType()) << "\","
      << "\"sequenceCount\":" << alignment.data.size() << ","
      << "\"sequenceLength\":" << alignment.ref_seq.size()
      << "},"
      << "\"effective\":" << (effective ? "true" : "false");
  appendDivergenceSummary(out, alignment);
  out << ",\"warningSummary\":{";
  appendWarningSummary(out, getWarningSummary(alignment, false, 0, {}));
  out << "},\"warnings\":[]}";
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

  out << ",\"warnings\":[]}";

  return out.str();
}

std::string extractSprtaValue(const std::string& comment) {
  std::size_t pos = 0;
  while ((pos = comment.find("sprta=", pos)) != std::string::npos) {
    if (pos >= 6 && comment.substr(pos - 6, 6) == "input_") {
      pos += 6;
      continue;
    }

    std::size_t value_start = pos + 6;
    std::size_t value_end = value_start;
    while (value_end < comment.size() &&
           comment[value_end] != ',' &&
           comment[value_end] != ']' &&
           comment[value_end] != '}') {
      ++value_end;
    }
    return comment.substr(value_start, value_end - value_start);
  }

  return "";
}

bool hasSuffix(const std::string& value, const std::string& suffix) {
  return value.size() >= suffix.size() &&
         value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool isGeneratedInternalName(const std::string& label) {
  if (hasSuffix(label, "_MinorSeqsClade")) return true;
  if (label.size() < 2 || label[0] != 'i' || label[1] != 'n') return false;
  return std::all_of(label.begin() + 2, label.end(), [](unsigned char ch) {
    return std::isdigit(ch) != 0;
  });
}

std::string extractTreeFromNexus(const std::string& nexus) {
  const std::string marker = "tree TREE1 = [&R] ";
  std::size_t start = nexus.find(marker);
  if (start == std::string::npos) return "";
  start += marker.size();

  std::size_t end = nexus.find('\n', start);
  if (end == std::string::npos) end = nexus.size();

  return nexus.substr(start, end - start);
}

std::string sprtaNexusToSupportNewick(const std::string& nexus) {
  std::string tree = extractTreeFromNexus(nexus);
  if (tree.empty()) return "";

  std::size_t comment_start = 0;
  while ((comment_start = tree.find("[&", comment_start)) != std::string::npos) {
    std::size_t comment_end = tree.find(']', comment_start);
    if (comment_end == std::string::npos) break;

    const std::string comment =
        tree.substr(comment_start, comment_end - comment_start + 1);
    const std::string sprta = extractSprtaValue(comment);

    std::size_t colon = tree.rfind(':', comment_start);
    std::size_t label_start = std::string::npos;
    if (colon != std::string::npos) {
      const std::size_t delimiter = tree.find_last_of("(,)", colon);
      label_start = delimiter == std::string::npos ? 0 : delimiter + 1;
    }

    if (!sprta.empty() && colon != std::string::npos &&
        label_start != std::string::npos) {
      const std::string label = tree.substr(label_start, colon - label_start);
      if (isGeneratedInternalName(label)) {
        tree.replace(label_start, colon - label_start, sprta);
        const std::ptrdiff_t label_delta =
            static_cast<std::ptrdiff_t>(sprta.size()) -
            static_cast<std::ptrdiff_t>(label.size());
        comment_start = static_cast<std::size_t>(
            static_cast<std::ptrdiff_t>(comment_start) + label_delta);
        comment_end = static_cast<std::size_t>(
            static_cast<std::ptrdiff_t>(comment_end) + label_delta);
      }
    }

    tree.erase(comment_start, comment_end - comment_start + 1);
  }

  std::size_t search_from = 0;
  while ((search_from = tree.find(')', search_from)) != std::string::npos) {
    const std::size_t label_start = search_from + 1;
    std::size_t label_end = label_start;
    while (label_end < tree.size() &&
           tree[label_end] != ':' &&
           tree[label_end] != ',' &&
           tree[label_end] != ')' &&
           tree[label_end] != ';') {
      ++label_end;
    }

    if (label_end < tree.size() && tree[label_end] == ':') {
      const std::string label = tree.substr(label_start, label_end - label_start);
      if (isGeneratedInternalName(label)) {
        tree.erase(label_start, label_end - label_start);
        search_from = label_start;
        continue;
      }
    }

    search_from = label_end;
  }

  return tree;
}

bool isUnrecognizedCharacterError(const std::exception& err) {
  return std::string_view(err.what()).find("Unrecognized character ") !=
      std::string_view::npos;
}

std::unique_ptr<cmaple::Alignment> parseAlignmentWithSeqType(
    std::string_view alignment_text,
    const int format,
    const cmaple::SeqRegion::SeqType sequence_type) {
  MemoryInputBuffer alignment_buffer(alignment_text);
  std::istream alignment_stream(&alignment_buffer);
  return std::make_unique<cmaple::Alignment>(
      alignment_stream,
      "",
      toCmapleFormat(format),
      sequence_type);
}

cmaple::ModelBase::SubModel toCmapleSubstitutionModel(
    const int substitution_model) {
  switch (substitution_model) {
    case SUBSTITUTION_MODEL_JC:
      return cmaple::ModelBase::JC;
    case SUBSTITUTION_MODEL_UNREST:
      return cmaple::ModelBase::UNREST;
    case SUBSTITUTION_MODEL_GTR20:
      return cmaple::ModelBase::GTR20;
    case SUBSTITUTION_MODEL_NONREV:
      return cmaple::ModelBase::NONREV;
    case SUBSTITUTION_MODEL_LG:
      return cmaple::ModelBase::LG;
    case SUBSTITUTION_MODEL_WAG:
      return cmaple::ModelBase::WAG;
    case SUBSTITUTION_MODEL_JTT:
      return cmaple::ModelBase::JTT;
    case SUBSTITUTION_MODEL_Q_PFAM:
      return cmaple::ModelBase::Q_PFAM;
    case SUBSTITUTION_MODEL_Q_BIRD:
      return cmaple::ModelBase::Q_BIRD;
    case SUBSTITUTION_MODEL_Q_MAMMAL:
      return cmaple::ModelBase::Q_MAMMAL;
    case SUBSTITUTION_MODEL_Q_INSECT:
      return cmaple::ModelBase::Q_INSECT;
    case SUBSTITUTION_MODEL_Q_PLANT:
      return cmaple::ModelBase::Q_PLANT;
    case SUBSTITUTION_MODEL_Q_YEAST:
      return cmaple::ModelBase::Q_YEAST;
    case SUBSTITUTION_MODEL_JTTDCMUT:
      return cmaple::ModelBase::JTTDCMUT;
    case SUBSTITUTION_MODEL_DCMUT:
      return cmaple::ModelBase::DCMUT;
    case SUBSTITUTION_MODEL_VT:
      return cmaple::ModelBase::VT;
    case SUBSTITUTION_MODEL_PMB:
      return cmaple::ModelBase::PMB;
    case SUBSTITUTION_MODEL_BLOSUM62:
      return cmaple::ModelBase::BLOSUM62;
    case SUBSTITUTION_MODEL_DAYHOFF:
      return cmaple::ModelBase::DAYHOFF;
    case SUBSTITUTION_MODEL_MTREV:
      return cmaple::ModelBase::MTREV;
    case SUBSTITUTION_MODEL_MTART:
      return cmaple::ModelBase::MTART;
    case SUBSTITUTION_MODEL_MTZOA:
      return cmaple::ModelBase::MTZOA;
    case SUBSTITUTION_MODEL_MTMET:
      return cmaple::ModelBase::MTMET;
    case SUBSTITUTION_MODEL_MTVER:
      return cmaple::ModelBase::MTVER;
    case SUBSTITUTION_MODEL_MTINV:
      return cmaple::ModelBase::MTINV;
    case SUBSTITUTION_MODEL_MTMAM:
      return cmaple::ModelBase::MTMAM;
    case SUBSTITUTION_MODEL_FLAVI:
      return cmaple::ModelBase::FLAVI;
    case SUBSTITUTION_MODEL_HIVB:
      return cmaple::ModelBase::HIVB;
    case SUBSTITUTION_MODEL_HIVW:
      return cmaple::ModelBase::HIVW;
    case SUBSTITUTION_MODEL_FLU:
      return cmaple::ModelBase::FLU;
    case SUBSTITUTION_MODEL_RTREV:
      return cmaple::ModelBase::RTREV;
    case SUBSTITUTION_MODEL_CPREV:
      return cmaple::ModelBase::CPREV;
    case SUBSTITUTION_MODEL_NQ_PFAM:
      return cmaple::ModelBase::NQ_PFAM;
    case SUBSTITUTION_MODEL_NQ_BIRD:
      return cmaple::ModelBase::NQ_BIRD;
    case SUBSTITUTION_MODEL_NQ_MAMMAL:
      return cmaple::ModelBase::NQ_MAMMAL;
    case SUBSTITUTION_MODEL_NQ_INSECT:
      return cmaple::ModelBase::NQ_INSECT;
    case SUBSTITUTION_MODEL_NQ_PLANT:
      return cmaple::ModelBase::NQ_PLANT;
    case SUBSTITUTION_MODEL_NQ_YEAST:
      return cmaple::ModelBase::NQ_YEAST;
    case SUBSTITUTION_MODEL_GTR:
    default:
      return cmaple::ModelBase::GTR;
  }
}

std::string substitutionModelName(const int substitution_model) {
  switch (substitution_model) {
    case SUBSTITUTION_MODEL_JC:
      return "JC";
    case SUBSTITUTION_MODEL_UNREST:
      return "UNREST";
    case SUBSTITUTION_MODEL_GTR20:
      return "GTR20";
    case SUBSTITUTION_MODEL_NONREV:
      return "NONREV";
    case SUBSTITUTION_MODEL_LG:
      return "LG";
    case SUBSTITUTION_MODEL_WAG:
      return "WAG";
    case SUBSTITUTION_MODEL_JTT:
      return "JTT";
    case SUBSTITUTION_MODEL_Q_PFAM:
      return "Q.PFAM";
    case SUBSTITUTION_MODEL_Q_BIRD:
      return "Q.BIRD";
    case SUBSTITUTION_MODEL_Q_MAMMAL:
      return "Q.MAMMAL";
    case SUBSTITUTION_MODEL_Q_INSECT:
      return "Q.INSECT";
    case SUBSTITUTION_MODEL_Q_PLANT:
      return "Q.PLANT";
    case SUBSTITUTION_MODEL_Q_YEAST:
      return "Q.YEAST";
    case SUBSTITUTION_MODEL_JTTDCMUT:
      return "JTTDCMUT";
    case SUBSTITUTION_MODEL_DCMUT:
      return "DCMUT";
    case SUBSTITUTION_MODEL_VT:
      return "VT";
    case SUBSTITUTION_MODEL_PMB:
      return "PMB";
    case SUBSTITUTION_MODEL_BLOSUM62:
      return "BLOSUM62";
    case SUBSTITUTION_MODEL_DAYHOFF:
      return "DAYHOFF";
    case SUBSTITUTION_MODEL_MTREV:
      return "MTREV";
    case SUBSTITUTION_MODEL_MTART:
      return "MTART";
    case SUBSTITUTION_MODEL_MTZOA:
      return "MTZOA";
    case SUBSTITUTION_MODEL_MTMET:
      return "MTMET";
    case SUBSTITUTION_MODEL_MTVER:
      return "MTVER";
    case SUBSTITUTION_MODEL_MTINV:
      return "MTINV";
    case SUBSTITUTION_MODEL_MTMAM:
      return "MTMAM";
    case SUBSTITUTION_MODEL_FLAVI:
      return "FLAVI";
    case SUBSTITUTION_MODEL_HIVB:
      return "HIVB";
    case SUBSTITUTION_MODEL_HIVW:
      return "HIVW";
    case SUBSTITUTION_MODEL_FLU:
      return "FLU";
    case SUBSTITUTION_MODEL_RTREV:
      return "RTREV";
    case SUBSTITUTION_MODEL_CPREV:
      return "CPREV";
    case SUBSTITUTION_MODEL_NQ_PFAM:
      return "NQ.PFAM";
    case SUBSTITUTION_MODEL_NQ_BIRD:
      return "NQ.BIRD";
    case SUBSTITUTION_MODEL_NQ_MAMMAL:
      return "NQ.MAMMAL";
    case SUBSTITUTION_MODEL_NQ_INSECT:
      return "NQ.INSECT";
    case SUBSTITUTION_MODEL_NQ_PLANT:
      return "NQ.PLANT";
    case SUBSTITUTION_MODEL_NQ_YEAST:
      return "NQ.YEAST";
    case SUBSTITUTION_MODEL_GTR:
    default:
      return "GTR";
  }
}

std::string inferAlignment(cmaple::Alignment& alignment,
                           int num_threads,
                           int substitution_model,
                           int branch_support_method,
                           int branch_support_replicates,
                           double branch_support_epsilon,
                           int filter_divergent_samples,
                           double max_divergence_percent,
                           const ConstantSiteCounts& constant_sites,
                           const unsigned char* tree_data,
                           const unsigned int tree_size,
                           const int branch_lengths_fixed,
                           const int no_reroot,
                           const int tree_search_mode) {
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
              << ". CMAPLE requires at least 3 samples. Increase the "
                 "threshold or turn filtering off.";
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

  if (alignment.getSeqType() != cmaple::SeqRegion::SEQ_DNA &&
      totalConstantSites(constant_sites) > 0) {
    return errorJson("Constant site counts are only supported for DNA alignments.");
  }
  ScopedConstantSites scoped_constant_sites(alignment, constant_sites);
  const WarningSummary warning_summary =
      getWarningSummary(alignment, false, 0, {});
  if (warning_summary.variable_columns == 0) {
    return errorJson("Alignment has no variable sites.");
  }

  const bool effective = cmaple::isEffective(alignment);
  cmaple::Model model(toCmapleSubstitutionModel(substitution_model),
                      alignment.getSeqType());
  std::cout << "Substitution model: "
            << substitutionModelName(substitution_model) << std::endl;
  std::unique_ptr<cmaple::Tree> tree;
  if (tree_data != nullptr && tree_size > 0) {
    const std::string_view tree_text = trimAlignmentBytes(tree_data, tree_size);
    if (tree_text.empty()) {
      return errorJson("Reference tree file is empty.");
    }

    MemoryInputBuffer tree_buffer(tree_text);
    std::istream tree_stream(&tree_buffer);
    tree = std::make_unique<cmaple::Tree>(
        &alignment, &model, tree_stream, branch_lengths_fixed != 0);
    std::cout << "Reference tree: loaded";
    if (branch_lengths_fixed != 0) {
      std::cout << " with fixed branch lengths";
    }
    if (no_reroot != 0 && tree->params) {
      tree->params->allow_rerooting = false;
      std::cout << " without rerooting";
    }
    std::cout << std::endl;
  } else {
    tree = std::make_unique<cmaple::Tree>(&alignment, &model);
    std::cout << "Reference tree: none" << std::endl;
  }
  if (branch_support_method != BRANCH_SUPPORT_NONE &&
      branch_support_method != BRANCH_SUPPORT_SPRTA &&
      branch_support_method != BRANCH_SUPPORT_SH_ALRT) {
    branch_support_method = BRANCH_SUPPORT_NONE;
  }
  const bool compute_sprta = branch_support_method == BRANCH_SUPPORT_SPRTA;
  if (compute_sprta && tree->params) {
    tree->params->compute_SPRTA_zero_length_branches = true;
    tree->params->print_SPRTA_less_info_seqs = true;
  }
  if (branch_support_method == BRANCH_SUPPORT_SPRTA) {
    std::cout << "Branch support: SPRTA" << std::endl;
  } else if (branch_support_method == BRANCH_SUPPORT_SH_ALRT) {
    std::cout << "Branch support: SH-aLRT ("
              << branch_support_replicates << " replicates, epsilon "
              << branch_support_epsilon << ")" << std::endl;
  } else {
    std::cout << "Branch support: off" << std::endl;
  }
  cmaple::Tree::TreeSearchType selected_tree_search =
      cmaple::Tree::NORMAL_TREE_SEARCH;
  if (tree_search_mode == TREE_SEARCH_FAST) {
    selected_tree_search = cmaple::Tree::FAST_TREE_SEARCH;
  } else if (tree_search_mode == TREE_SEARCH_EXHAUSTIVE) {
    selected_tree_search = cmaple::Tree::EXHAUSTIVE_TREE_SEARCH;
  }
  std::cout << "Tree search: "
            << (selected_tree_search == cmaple::Tree::FAST_TREE_SEARCH
                    ? "FAST"
                    : selected_tree_search == cmaple::Tree::EXHAUSTIVE_TREE_SEARCH
                          ? "EXHAUSTIVE"
                          : "NORMAL")
            << std::endl;

  double phase_started_ms = nowMs();
  if (compute_sprta) {
    std::cout << "Computing SPRTA supports" << std::endl;
  }
  const int inference_threads = 1;
  tree->infer(inference_threads,
             compute_sprta ? cmaple::Tree::EXHAUSTIVE_TREE_SEARCH
                            : selected_tree_search,
             false,
             compute_sprta);
  profileLog("treeInfer", nowMs() - phase_started_ms);

  if (!compute_sprta && branch_support_method == BRANCH_SUPPORT_SH_ALRT &&
      branch_support_replicates > 0) {
    phase_started_ms = nowMs();
    tree->computeBranchSupport(num_threads, branch_support_replicates, branch_support_epsilon);
    profileLog("branchSupport", nowMs() - phase_started_ms);
  }

  phase_started_ms = nowMs();
  const double log_likelihood = tree->computeLh();
  profileLog("computeLh", nowMs() - phase_started_ms);

  phase_started_ms = nowMs();
  std::string newick;
  if (compute_sprta) {
    const std::string nexus =
        tree->exportNexus(cmaple::Tree::BIN_TREE, true, false);
    newick = sprtaNexusToSupportNewick(nexus);
    if (newick.empty()) {
      newick = tree->exportNewick(cmaple::Tree::BIN_TREE, false, true);
    }
  } else {
    newick = tree->exportNewick(cmaple::Tree::BIN_TREE, false, true);
  }
  profileLog("exportNewick", nowMs() - phase_started_ms);

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
  const std::size_t fasta_headers = countFastaHeaders(alignment_text);
  if (toCmapleFormat(format) == cmaple::Alignment::IN_FASTA &&
      fasta_headers > 0 && fasta_headers < 3) {
    std::ostringstream message;
    message << "FASTA input contains " << fasta_headers
            << " sequence" << (fasta_headers == 1 ? "" : "s")
            << ". CMAPLE requires at least 3 sequences.";
    throw std::invalid_argument(message.str());
  }

  try {
    return parseAlignmentWithSeqType(
        alignment_text, format, cmaple::SeqRegion::SEQ_AUTO);
  } catch (const std::exception& err) {
    if (!isUnrecognizedCharacterError(err)) {
      throw;
    }

    return parseAlignmentWithSeqType(
        alignment_text, format, cmaple::SeqRegion::SEQ_PROTEIN);
  }
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
                               int substitution_model,
                               int branch_support_method,
                               int branch_support_replicates,
                               double branch_support_epsilon,
                               int filter_divergent_samples,
                               double max_divergence_percent,
                               unsigned int constant_a,
                               unsigned int constant_c,
                               unsigned int constant_g,
                               unsigned int constant_t,
                               const unsigned char* tree_data,
                               unsigned int tree_size,
                               int branch_lengths_fixed,
                               int no_reroot,
                               int tree_search_mode) {
  try {
    if (data == nullptr || size == 0) {
      return copyResult(errorJson("Alignment file is empty."));
    }

    normalizeNumThreads(num_threads);
    normalizeBranchSupportReplicates(branch_support_replicates);

    cmaple::verbose_mode = inferenceVerboseMode();

    auto alignment = parseAlignment(data, size, format);
    const ConstantSiteCounts constant_sites{
        constant_a, constant_c, constant_g, constant_t};
    return copyResult(inferAlignment(*alignment,
                                     num_threads,
                                     substitution_model,
                                     branch_support_method,
                                     branch_support_replicates,
                                     branch_support_epsilon,
                                     filter_divergent_samples,
                                     max_divergence_percent,
                                     constant_sites,
                                     tree_data,
                                     tree_size,
                                     branch_lengths_fixed,
                                     no_reroot,
                                     tree_search_mode));
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
                                      int substitution_model,
                                      int branch_support_method,
                                      int branch_support_replicates,
                                      double branch_support_epsilon,
                                      int filter_divergent_samples,
                                      double max_divergence_percent,
                                      unsigned int constant_a,
                                      unsigned int constant_c,
                                      unsigned int constant_g,
                                      unsigned int constant_t,
                                      const unsigned char* tree_data,
                                      unsigned int tree_size,
                                      int branch_lengths_fixed,
                                      int no_reroot,
                                      int tree_search_mode) {
  try {
    auto loaded = loaded_alignments.find(handle);
    if (loaded == loaded_alignments.end()) {
      return copyResult(errorJson(
          "The parsed alignment is no longer loaded. Drop the file again."));
    }

    normalizeNumThreads(num_threads);
    normalizeBranchSupportReplicates(branch_support_replicates);
    cmaple::verbose_mode = inferenceVerboseMode();

    cmaple::Alignment& alignment = *loaded->second.alignment;
    const ConstantSiteCounts constant_sites{
        constant_a, constant_c, constant_g, constant_t};
    return copyResult(inferAlignment(alignment,
                                     num_threads,
                                     substitution_model,
                                     branch_support_method,
                                     branch_support_replicates,
                                     branch_support_epsilon,
                                     filter_divergent_samples,
                                     max_divergence_percent,
                                     constant_sites,
                                     tree_data,
                                     tree_size,
                                     branch_lengths_fixed,
                                     no_reroot,
                                     tree_search_mode));
  } catch (const std::exception& err) {
    return copyResult(errorJson(err.what()));
  } catch (...) {
    return copyResult(errorJson("CMAPLE failed with an unknown error."));
  }
}

extern "C" char* cmaple_warning_summary(unsigned int handle,
                                         int filter_divergent_samples,
                                         double max_divergence_percent,
                                         unsigned int constant_a,
                                         unsigned int constant_c,
                                         unsigned int constant_g,
                                         unsigned int constant_t) {
  try {
    auto loaded = loaded_alignments.find(handle);
    if (loaded == loaded_alignments.end()) {
      return copyResult(errorJson(
          "The parsed alignment is no longer loaded. Drop the file again."));
    }

    cmaple::verbose_mode = cmaple::VB_QUIET;
    cmaple::Alignment& alignment = *loaded->second.alignment;
    const ConstantSiteCounts constant_sites{
        constant_a, constant_c, constant_g, constant_t};
    return copyResult(warningSummaryJson(
        alignment,
        filter_divergent_samples != 0,
        max_divergence_percent,
        constant_sites));
  } catch (const std::exception& err) {
    return copyResult(errorJson(err.what()));
  } catch (...) {
    return copyResult(errorJson("CMAPLE warning summary failed with an unknown error."));
  }
}

extern "C" char* cmaple_export_maple(unsigned int handle) {
  try {
    auto loaded = loaded_alignments.find(handle);
    if (loaded == loaded_alignments.end()) {
      return copyResult(errorJson(
          "The parsed alignment is no longer loaded. Drop the file again."));
    }

    cmaple::verbose_mode = cmaple::VB_QUIET;
    cmaple::Alignment& alignment = *loaded->second.alignment;
    return copyResult(mapleExportJson(alignment));
  } catch (const std::exception& err) {
    return copyResult(errorJson(err.what()));
  } catch (...) {
    return copyResult(errorJson("CMAPLE MAPLE export failed with an unknown error."));
  }
}
