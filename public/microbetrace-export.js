(function () {
  'use strict'

  var DATABASE_NAME = 'microbetrace-partner-export'
  var DATABASE_VERSION = 1
  var STORE_NAME = 'handoffs'
  var button = document.getElementById('continue')
  var summary = document.getElementById('summary')
  var status = document.getElementById('status')
  var record

  function getConfig() {
    var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    return isLocal
      ? { partnerId: 'local-dev', target: 'http://localhost:4200/' }
      : { partnerId: 'syrup', target: 'https://microbetrace.cdc.gov/MicrobeTrace/' }
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = function () { resolve(request.result) }
      request.onerror = function () { reject(request.error || new Error('Unable to open the Syrup export database.')) }
    })
  }

  function withRecord(id, mode, action) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, mode)
        var request = action(transaction.objectStore(STORE_NAME))
        request.onsuccess = function () { resolve(request.result) }
        request.onerror = function () { reject(request.error || new Error('Unable to access the staged analysis.')) }
        transaction.oncomplete = function () { database.close() }
        transaction.onerror = function () {
          database.close()
          reject(transaction.error || new Error('Unable to access the staged analysis.'))
        }
      })
    })
  }

  function deleteRecord(id) {
    return withRecord(id, 'readwrite', function (store) { return store.delete(id) })
  }

  function validateRecord(value, id, config) {
    if (!value || value.id !== id || value.version !== 1 || !value.options || !Array.isArray(value.options.files)) {
      throw new Error('The staged analysis is missing or malformed.')
    }
    if (!Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) {
      throw new Error('The staged analysis has expired. Return to Syrup and try again.')
    }
    if (value.options.partnerId !== config.partnerId || value.options.target !== config.target) {
      throw new Error('The staged analysis does not match this Syrup environment.')
    }
    return value
  }

  function loadSdk(target) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script')
      script.src = new URL('assets/embed/microbetrace-embed.js', target).toString()
      script.onload = function () {
        if (window.MicrobeTraceEmbed) resolve(window.MicrobeTraceEmbed)
        else reject(new Error('The MicrobeTrace SDK loaded without its browser API.'))
      }
      script.onerror = function () { reject(new Error('Could not load the MicrobeTrace SDK.')) }
      document.head.appendChild(script)
    })
  }

  function showError(error) {
    status.className = 'error'
    status.textContent = error && error.message ? error.message : String(error)
  }

  var config = getConfig()
  var handoffId = new URLSearchParams(location.hash.slice(1)).get('handoff')
  if (!handoffId || !/^[a-z0-9-]{16,128}$/i.test(handoffId)) {
    showError(new Error('The bridge URL does not contain a valid handoff identifier.'))
  } else {
    Promise.all([
      withRecord(handoffId, 'readonly', function (store) { return store.get(handoffId) }),
      loadSdk(config.target),
    ]).then(function (values) {
      record = validateRecord(values[0], handoffId, config)
      var names = record.options.files.map(function (file) { return file.name })
      summary.textContent = 'Ready to send ' + names.join(' and ') + '.'
      button.disabled = false
    }).catch(function (error) {
      showError(error)
      deleteRecord(handoffId).catch(function () {})
    })
  }

  button.addEventListener('click', function () {
    if (!record || !window.MicrobeTraceEmbed) return

    button.disabled = true
    status.className = ''
    status.textContent = 'Opening MicrobeTrace…'
    var openPromise
    try {
      openPromise = window.MicrobeTraceEmbed.open(record.options)
    } catch (error) {
      showError(error)
      button.disabled = false
      return
    }
    deleteRecord(record.id).catch(function () {})

    openPromise.then(function () {
      status.textContent = 'MicrobeTrace accepted the analysis.'
    }).catch(function (error) {
      showError(error)
      button.disabled = false
    })
  })
}())
