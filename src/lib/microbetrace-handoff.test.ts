import assert from 'node:assert/strict'
import test from 'node:test'
import { getMicrobeTraceConfig } from './microbetrace-handoff.ts'

test('uses local MicrobeTrace for an unconfigured localhost build', () => {
  assert.deepEqual(
    getMicrobeTraceConfig({ hostname: 'localhost' }, {}),
    { partnerId: 'local-dev', target: 'http://localhost:4200/' },
  )
})

test('lets local Syrup target the CDC development deployment', () => {
  assert.deepEqual(
    getMicrobeTraceConfig(
      { hostname: 'localhost' },
      { VITE_MICROBETRACE_TARGET: 'https://cdcgov.github.io/MicrobeTrace' },
    ),
    {
      partnerId: 'local-dev',
      target: 'https://cdcgov.github.io/MicrobeTrace/',
    },
  )
})

test('uses CDC development for a deployed Syrup build by default', () => {
  assert.deepEqual(
    getMicrobeTraceConfig({ hostname: 'syrup.cpg.org.au' }, {}),
    {
      partnerId: 'syrup',
      target: 'https://cdcgov.github.io/MicrobeTrace/',
    },
  )
})

test('accepts the production deployment as an explicit build target', () => {
  assert.deepEqual(
    getMicrobeTraceConfig(
      { hostname: 'syrup.cpg.org.au' },
      { VITE_MICROBETRACE_TARGET: 'https://microbetrace.cdc.gov/MicrobeTrace/' },
    ),
    {
      partnerId: 'syrup',
      target: 'https://microbetrace.cdc.gov/MicrobeTrace/',
    },
  )
})

test('rejects unapproved handoff targets', () => {
  assert.throws(
    () => getMicrobeTraceConfig(
      { hostname: 'syrup.cpg.org.au' },
      { VITE_MICROBETRACE_TARGET: 'https://example.org/MicrobeTrace/' },
    ),
    /approved MicrobeTrace deployment URL/,
  )
})
