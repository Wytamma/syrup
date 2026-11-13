import { mount } from 'svelte'
import './app.css'
import TreeLibrary from './lib/components/TreeLibrary.svelte'

// The app shell clips to the viewport; this page scrolls with the document.
document.body.classList.add('trees-document')

mount(TreeLibrary, { target: document.getElementById('app')! })
