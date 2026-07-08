<script lang="ts">
  import type { SequenceType, SubstitutionModel } from '../../types/cmaple'

  export let value: SubstitutionModel = 'GTR'
  export let sequenceType: SequenceType = 'dna'
  export let disabled = false
  export let onChange: (value: SubstitutionModel) => void = () => {}

  const dnaModels: SubstitutionModel[] = ['GTR', 'JC', 'UNREST']
  const proteinModels: SubstitutionModel[] = [
    'LG',
    'WAG',
    'JTT',
    'GTR20',
    'NONREV',
    'Q.PFAM',
    'Q.BIRD',
    'Q.MAMMAL',
    'Q.INSECT',
    'Q.PLANT',
    'Q.YEAST',
    'JTTDCMUT',
    'DCMUT',
    'VT',
    'PMB',
    'BLOSUM62',
    'DAYHOFF',
    'MTREV',
    'MTART',
    'MTZOA',
    'MTMET',
    'MTVER',
    'MTINV',
    'MTMAM',
    'FLAVI',
    'HIVB',
    'HIVW',
    'FLU',
    'RTREV',
    'CPREV',
    'NQ.PFAM',
    'NQ.BIRD',
    'NQ.MAMMAL',
    'NQ.INSECT',
    'NQ.PLANT',
    'NQ.YEAST',
  ]

  $: models = sequenceType === 'protein' ? proteinModels : dnaModels
</script>

<div class="option-group substitution-model-group">
  <div class="option-heading">
    <span>Substitution model</span>
  </div>
  <label class="number-option substitution-model-option">
    <select
      value={value}
      disabled={disabled}
      onchange={(event) => onChange(event.currentTarget.value as SubstitutionModel)}
      aria-label="Substitution model"
    >
      {#each models as model}
        <option value={model}>{model}</option>
      {/each}
    </select>
  </label>
</div>
