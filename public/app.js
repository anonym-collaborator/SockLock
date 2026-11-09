const element = id => document.getElementById(id);
const state = { samples: [], angles: [], angleIds: [], references: [], referenceIds: [], providers: new Map(), mode: 'local', filter: 'all', result: null, dirty: false, synthetic: false, busy: false, reviewStart: 0 };
const LIBRARY_STORAGE_KEY = 'socklock-variants.reference-library.v1';
let toastTimeout;

function icons() { window.lucide?.createIcons(); }
function notify(message) {
  element('toast').textContent = message;
  element('toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { element('toast').hidden = true; }, 3500);
}

async function request(path, payload) {
  const response = await fetch(path, payload === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed.' }));
    throw new Error(data.error || 'Request failed.');
  }
  return response;
}

function briefFromForm() {
  return {
    brand: element('brand').value, audience: element('audience').value, pain: element('pain').value,
    script: element('script').value, offer: element('offer').value, facts: element('facts').value,
    count: Number(element('count').value), syntheticExample: state.synthetic,
    angleIds: [...state.angleIds], references: state.references.filter(reference => state.referenceIds.includes(reference.id)),
  };
}

function fillBrief(brief) {
  for (const name of ['brand', 'audience', 'pain', 'script', 'offer', 'count']) element(name).value = brief[name];
  element('facts').value = typeof brief.facts === 'string' ? brief.facts : brief.facts.map(fact => typeof fact === 'string' ? fact : fact.text).join('\n');
  state.angleIds = brief.angleIds || state.angles.map(angle => angle.id);
  state.referenceIds = (brief.references || []).map(reference => reference.id);
  state.synthetic = brief.syntheticExample === true;
  element('synthetic-label').textContent = state.synthetic ? 'Synthetic example' : 'User-provided reference';
}

function loadSample(index) {
  fillBrief(state.samples[index].brief);
  state.result = null;
  state.dirty = false;
  state.filter = 'all';
  element('form-error').hidden = true;
  element('empty-description').textContent = state.samples[index].label;
  render();
}

function markBriefChanged() {
  if (state.result) {
    state.dirty = true;
    state.result.variants.forEach(variant => { variant.approved = false; });
  }
  render();
}

function clearBrief() {
  for (const name of ['audience', 'pain', 'script', 'offer', 'facts']) element(name).value = '';
  element('brand').value = 'SockLock';
  element('count').value = 10;
  state.angleIds = state.angles.map(angle => angle.id);
  state.referenceIds = [];
  state.result = null;
  state.dirty = false;
  state.synthetic = false;
  state.filter = 'all';
  element('synthetic-label').textContent = 'Your brief';
  element('empty-description').textContent = '';
  element('form-error').hidden = true;
  render();
}

async function storeReferenceLibrary(references) {
  const serialized = JSON.stringify({ schemaVersion: 1, kind: 'reference-library', references });
  if (new Blob([serialized]).size > 50000) throw new Error('The library must be smaller than 50 KB.');
  const validated = await (await request('/api/library/validate', { references })).json();
  const before = JSON.stringify(state.references.filter(reference => state.referenceIds.includes(reference.id)));
  state.references = validated.references;
  state.referenceIds = state.referenceIds.filter(id => state.references.some(reference => reference.id === id));
  try { localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, kind: 'reference-library', references: state.references })); }
  catch { notify('Browser storage unavailable; use Export reference library to keep your scripts.'); }
  const after = JSON.stringify(state.references.filter(reference => state.referenceIds.includes(reference.id)));
  if (before !== after) markBriefChanged();
  else render();
}

function renderLibrary() {
  element('reference-selection-count').textContent = `${state.referenceIds.length} / 5 selected`;
  const rows = state.references.map(reference => {
    const row = textNode('div', 'reference-row-control', '');
    row.dataset.referenceId = reference.id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `reference-choice-${reference.id}`;
    checkbox.checked = state.referenceIds.includes(reference.id);
    checkbox.disabled = state.busy || (!checkbox.checked && state.referenceIds.length >= 5);
    checkbox.setAttribute('aria-label', `Use ${reference.title}`);
    checkbox.addEventListener('change', () => {
      state.referenceIds = checkbox.checked ? [...state.referenceIds, reference.id] : state.referenceIds.filter(id => id !== reference.id);
      markBriefChanged();
    });
    const label = textNode('label', 'reference-label', reference.title);
    label.htmlFor = checkbox.id;
    label.append(textNode('small', '', reference.synthetic ? 'Synthetic style example' : 'User-provided style reference'));
    const actions = textNode('div', 'reference-actions', '');
    actions.append(iconButton('eye', `View reference ${reference.title}`, () => openReference(reference, true)), iconButton('pencil', `Edit reference ${reference.title}`, () => openReference(reference)), iconButton('trash-2', `Delete reference ${reference.title}`, async () => {
      if (!confirm(`Delete "${reference.title}" from the local reference library?`)) return;
      try { await storeReferenceLibrary(state.references.filter(item => item.id !== reference.id)); notify('Reference deleted'); }
      catch (error) { showLibraryError(error.message); }
    }));
    actions.querySelectorAll('button').forEach(button => { button.disabled = state.busy; });
    row.append(checkbox, label, actions);
    return row;
  });
  element('reference-list').replaceChildren(...(rows.length ? rows : [textNode('p', 'muted', 'No reference scripts')]));
  for (const id of ['add-reference', 'import-library', 'export-library']) element(id).disabled = state.busy;
}

function showLibraryError(message) {
  element('library-error').textContent = message;
  element('library-error').hidden = false;
  element('reference-library').open = true;
}

function openReference(reference, readOnly = false) {
  element('reference-id').value = reference?.id || '';
  element('reference-title').textContent = readOnly ? 'View reference' : reference ? 'Edit reference' : 'Add reference';
  element('reference-name').value = reference?.title || '';
  element('reference-script').value = reference?.script || '';
  element('reference-synthetic').checked = reference?.synthetic === true;
  element('reference-name').readOnly = readOnly;
  element('reference-script').readOnly = readOnly;
  element('reference-synthetic').disabled = readOnly;
  element('save-reference').hidden = readOnly;
  element('reference-error').hidden = true;
  element('reference-dialog').showModal();
}

function initializeAngleControls() {
  element('angle-options').replaceChildren(...state.angles.map(angle => {
    const label = textNode('label', 'angle-choice', '');
    label.title = `${angle.description}\n${angle.example}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = angle.id;
    checkbox.setAttribute('aria-label', angle.label);
    checkbox.addEventListener('change', () => {
      state.angleIds = checkbox.checked ? [...state.angleIds, angle.id] : state.angleIds.filter(id => id !== angle.id);
      markBriefChanged();
    });
    label.append(checkbox, textNode('span', '', angle.label));
    return label;
  }));
}

function textNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function iconButton(icon, label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  const graphic = document.createElement('i');
  graphic.dataset.lucide = icon;
  button.append(graphic);
  button.addEventListener('click', action);
  return button;
}

function variantCard(variant) {
  const card = document.createElement('article');
  card.className = `variant-card${variant.approved ? ' approved' : ''}${variant.blocked ? ' blocked' : ''}`;
  card.dataset.variantId = variant.id;
  const heading = textNode('div', 'card-heading', '');
  const angle = textNode('div', 'angle-label', '');
  angle.append(textNode('span', 'variant-number', variant.id), textNode('span', '', state.angles.find(angle => angle.id === variant.angle)?.label || variant.angle));
  heading.append(angle, textNode('span', `status-tag${variant.approved ? ' approved' : variant.blocked ? ' blocked' : ''}`, variant.approved ? 'Approved draft' : variant.blocked ? 'Blocked' : 'Unreviewed'));
  card.append(heading, textNode('p', 'hook-text', variant.hook));
  const screen = textNode('div', 'card-detail', '');
  screen.append(textNode('span', 'card-label', 'ON-SCREEN TEXT'), textNode('p', 'screen-line', variant.onScreen));
  card.append(screen);
  for (const [label, content] of [['FIRST FRAME', variant.firstFrame], ['MODIFICATION', variant.reason]]) {
    const detail = textNode('div', 'card-detail', '');
    detail.append(textNode('span', 'card-label', label), textNode('p', '', content));
    card.append(detail);
  }
  const facts = textNode('div', 'fact-row', 'Facts: ');
  if (!variant.factIds.length) facts.append(textNode('span', '', 'none cited'));
  for (const id of variant.factIds) {
    const fact = textNode('span', 'fact-chip', id);
    fact.title = state.result.brief.facts.find(fact => fact.id === id)?.text || 'Unknown fact';
    facts.append(fact);
  }
  card.append(facts);
  const issues = variant.issues.filter(issue => issue.severity !== 'notice');
  if (issues.length) {
    const list = document.createElement('ul');
    list.className = 'issue-list';
    issues.forEach(issue => list.append(textNode('li', '', issue.message)));
    card.append(list);
  }
  const actions = textNode('div', 'card-actions', '');
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'approve-button';
  approve.setAttribute('aria-pressed', String(variant.approved));
  approve.setAttribute('aria-label', `${variant.approved ? 'Unapprove' : 'Approve'} ${variant.id}`);
  approve.disabled = variant.blocked || state.dirty || state.busy;
  const check = document.createElement('i');
  check.dataset.lucide = variant.approved ? 'check-check' : 'check';
  approve.append(check, textNode('span', '', variant.approved ? 'Approved' : 'Approve draft'));
  approve.addEventListener('click', () => { variant.approved = !variant.approved; render(); });
  const actionIcons = textNode('div', 'card-action-icons', '');
  const edit = iconButton('pencil', `Edit ${variant.id}`, () => openEditor(variant));
  edit.disabled = state.busy || state.dirty;
  actionIcons.append(edit, iconButton('copy', `Copy ${variant.id}`, async () => {
    try { await navigator.clipboard.writeText(`${variant.hook}\n\n${variant.onScreen}\n\n${variant.firstFrame}\n\nReference body (unchanged):\n${state.result.brief.script}\n\nOffer:\n${state.result.brief.offer}\n\nStatus: ${variant.approved ? 'human-approved draft' : 'unreviewed draft'}`); notify(`${variant.id} copied`); }
    catch { notify('Clipboard unavailable. Use workspace export.'); }
  }));
  actions.append(approve, actionIcons);
  card.append(actions);
  return card;
}

function render() {
  const variants = state.result?.variants || [];
  const approved = variants.filter(variant => variant.approved).length;
  element('all-count').textContent = variants.length;
  element('approved-count').textContent = approved;
  element('pending-count').textContent = variants.length - approved;
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
  element('provider-select').disabled = state.busy || !state.providers.size;
  element('provider-select').value = state.mode;
  const provider = state.providers.get(state.mode);
  element('provider-status').textContent = provider ? (provider.configured ? `Configured / ${provider.auth || 'custom'}` : 'Not configured') : 'Checking configuration';
  element('provider-status').title = provider?.configurationIssue || provider?.model || '';
  element('export-button').disabled = !approved || state.dirty || state.busy;
  element('save-project').disabled = state.busy;
  element('import-project').disabled = state.busy;
  element('reset-brief').disabled = state.busy;
  element('insert-example').disabled = state.busy || !state.samples.length;
  element('creative-angles').disabled = state.busy;
  document.querySelectorAll('#angle-options input').forEach(checkbox => { checkbox.checked = state.angleIds.includes(checkbox.value); });
  element('angle-selection-count').textContent = state.angleIds.length ? `${state.angleIds.length} selected / max ${Math.ceil(Number(element('count').value) / state.angleIds.length)} per angle` : 'No angles selected';
  element('generate-button').disabled = state.busy || !state.angleIds.length;
  element('generate-button').classList.toggle('is-loading', state.busy);
  element('generate-button').querySelector('span').textContent = state.busy ? 'Generating...' : 'Generate variants';
  const batchProvider = state.result ? state.providers.get(state.result.meta.providerId || state.result.meta.mode) : null;
  element('batch-status').textContent = state.result ? `${variants.length} drafts / ${approved} approved / ${batchProvider?.label || 'Imported provider'}` : 'No batch yet';
  element('workspace-alert').hidden = !state.dirty;
  element('workspace-alert').textContent = 'Brief changed. Generate a new batch before approving or exporting.';
  const visible = variants.filter(variant => state.filter === 'all' || (state.filter === 'approved' ? variant.approved : !variant.approved));
  element('variant-list').replaceChildren(...visible.map(variantCard));
  element('empty-state').hidden = visible.length > 0;
  element('empty-state').querySelector('h3').textContent = variants.length ? 'No drafts in this view' : 'No creative openings yet';
  element('batch-footer').hidden = !state.result;
  if (state.result) {
    element('run-source').textContent = `${state.result.meta.source}${state.result.meta.syntheticExample ? ' / synthetic source' : ''} / ${state.result.brief.references?.length || 0} style references`;
    element('run-time').textContent = `${state.result.meta.elapsedMs} ms generation / ${state.result.meta.runId.slice(0, 8)}`;
  }
  renderLibrary();
  icons();
}

function openEditor(variant) {
  element('edit-id').value = variant.id;
  element('edit-title').textContent = `Edit ${variant.id}`;
  const selected = state.result.brief.angleIds || state.angles.map(angle => angle.id);
  const options = selected.map(id => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = state.angles.find(angle => angle.id === id)?.label || id;
    return option;
  });
  if (!selected.includes(variant.angle)) {
    const previous = document.createElement('option');
    previous.value = variant.angle;
    previous.textContent = variant.angle;
    options.push(previous);
  }
  element('edit-angle').replaceChildren(...options);
  for (const [field, value] of [['angle', variant.angle], ['hook', variant.hook], ['screen', variant.onScreen], ['frame', variant.firstFrame], ['reason', variant.reason], ['facts', variant.factIds.join(', ')]]) element(`edit-${field}`).value = value;
  element('edit-error').hidden = true;
  element('edit-dialog').showModal();
  element('edit-hook').focus();
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

element('brief-form').addEventListener('input', event => {
  if (event.target.id === 'provider-select' || event.target.closest('#creative-angles,#reference-library')) return;
  state.synthetic = false;
  element('synthetic-label').textContent = 'User-edited brief';
  markBriefChanged();
});

element('brief-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  if (!state.angleIds.length) { element('form-error').textContent = 'Select at least one creative angle.'; element('form-error').hidden = false; return; }
  state.busy = true;
  element('form-error').hidden = true;
  render();
  try {
    state.result = await (await request('/api/generate', { brief: briefFromForm(), provider: state.mode })).json();
    state.dirty = false;
    state.filter = 'all';
    state.reviewStart = Date.now();
    render();
    if (window.innerWidth < 761) element('results-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    element('form-error').textContent = error.message;
    element('form-error').hidden = false;
  } finally { state.busy = false; render(); }
});

element('provider-select').addEventListener('change', event => { state.mode = event.target.value; element('form-error').hidden = true; render(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; render(); }));
element('insert-example').addEventListener('click', () => {
  if ((state.result || ['audience', 'pain', 'script', 'offer', 'facts'].some(id => element(id).value.trim())) && !confirm('Replace the current brief and batch with the synthetic example?')) return;
  loadSample(0);
});
element('reset-brief').addEventListener('click', () => { if (confirm('Clear the current brief and batch? The local reference library will stay.')) clearBrief(); });
element('select-all-angles').addEventListener('click', () => { state.angleIds = state.angles.map(angle => angle.id); markBriefChanged(); });
element('clear-angles').addEventListener('click', () => { state.angleIds = []; markBriefChanged(); });
for (const id of ['close-editor', 'cancel-editor']) element(id).addEventListener('click', () => element('edit-dialog').close());

element('edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const index = state.result.variants.findIndex(variant => variant.id === element('edit-id').value);
  const variants = structuredClone(state.result.variants);
  variants[index] = { ...variants[index], angle: element('edit-angle').value, hook: element('edit-hook').value, onScreen: element('edit-screen').value, firstFrame: element('edit-frame').value, reason: element('edit-reason').value, factIds: element('edit-facts').value.split(/[,;\s]+/).filter(Boolean), approved: false };
  try {
    const reviewed = await (await request('/api/review', { brief: state.result.brief, variants })).json();
    state.result.variants = reviewed.variants.map((variant, position) => ({ ...variant, approved: position !== index && !variant.blocked && variants[position].approved }));
    element('edit-dialog').close();
    render();
    notify(`${variants[index].id} saved; approval reset`);
  } catch (error) { element('edit-error').textContent = error.message; element('edit-error').hidden = false; }
});

element('export-button').addEventListener('click', async () => {
  try {
    const format = element('export-format').value;
    const response = await request('/api/export', { ...state.result, format });
    download(await response.blob(), `socklock-approved.${format}`);
    notify('Approved drafts exported');
  } catch (error) { notify(error.message); }
});

element('save-project').addEventListener('click', () => {
  if (state.dirty) { notify('Generate a new batch before saving the changed brief.'); return; }
  const project = { schemaVersion: 1, kind: 'workspace', brief: state.result?.brief || briefFromForm(), result: state.result, reviewElapsedMs: state.reviewStart ? Date.now() - state.reviewStart : null };
  download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'socklock-workspace.json');
  notify('Workspace saved locally');
});
element('import-project').addEventListener('click', () => element('project-file').click());
element('project-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 65536) throw new Error('Workspace must be smaller than 64 KB.');
    const project = JSON.parse(await file.text());
    if (project.schemaVersion !== 1 || project.kind !== 'workspace' || !project.brief) throw new Error('Choose a SockLock workspace JSON file.');
    const brief = project.result?.brief || project.brief;
    let result;
    if (project.result) {
      const reviewed = await (await request('/api/review', { brief, variants: project.result.variants })).json();
      const meta = project.result.meta;
      if (!meta || typeof meta.runId !== 'string' || typeof meta.source !== 'string' || !state.providers.has(meta.providerId || meta.mode)) throw new Error('Invalid or unregistered workspace provider.');
      result = { brief, variants: reviewed.variants, meta };
    } else {
      const checked = await (await request('/api/generate', { brief, mode: 'local' })).json();
      result = checked;
    }
    if (brief.references?.length) {
      const merged = new Map(state.references.map(reference => [reference.id, reference]));
      brief.references.forEach(reference => merged.set(reference.id, reference));
      await storeReferenceLibrary([...merged.values()]);
    }
    state.result = result;
    fillBrief({ ...brief, syntheticExample: state.result.meta.syntheticExample });
    state.dirty = false;
    state.filter = 'all';
    state.reviewStart = Date.now();
    render();
    notify('Workspace imported; all approvals reset');
  } catch (error) { notify(`Import failed: ${error.message}`); }
  event.target.value = '';
});

element('add-reference').addEventListener('click', () => openReference(null));
for (const id of ['close-reference', 'cancel-reference']) element(id).addEventListener('click', () => element('reference-dialog').close());
element('reference-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = element('reference-id').value || `reference-${crypto.randomUUID()}`;
  const reference = { id, title: element('reference-name').value.trim(), script: element('reference-script').value.trim(), synthetic: element('reference-synthetic').checked };
  const previous = state.references.find(item => item.id === id);
  const references = previous ? state.references.map(item => item.id === id ? reference : item) : [...state.references, reference];
  try {
    await storeReferenceLibrary(references);
    if (!previous && state.referenceIds.length < 5) { state.referenceIds.push(id); markBriefChanged(); }
    element('reference-dialog').close();
    element('library-error').hidden = true;
    notify('Reference saved locally');
  } catch (error) { element('reference-error').textContent = error.message; element('reference-error').hidden = false; }
});
element('export-library').addEventListener('click', () => download(new Blob([JSON.stringify({ schemaVersion: 1, kind: 'reference-library', references: state.references }, null, 2)], { type: 'application/json' }), 'socklock-reference-library.json'));
element('import-library').addEventListener('click', () => element('library-file').click());
element('library-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 50000) throw new Error('The library must be smaller than 50 KB.');
    const library = JSON.parse(await file.text());
    if (library.schemaVersion !== 1 || library.kind !== 'reference-library') throw new Error('Choose a reference-library JSON file.');
    if (!confirm('Replace the local reference library with this file?')) return;
    await storeReferenceLibrary(library.references);
    element('library-error').hidden = true;
    notify('Reference library imported');
  } catch (error) { showLibraryError(`Import failed: ${error.message}`); }
  finally { event.target.value = ''; }
});

async function initialize() {
  try {
    const [samples, configuration, library] = await Promise.all([request('/api/samples').then(response => response.json()), request('/api/config').then(response => response.json()), request('/api/library').then(response => response.json())]);
    state.samples = samples;
    state.angles = library.angles;
    state.references = library.references;
    try {
      const saved = localStorage.getItem(LIBRARY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.schemaVersion !== 1 || parsed.kind !== 'reference-library') throw new Error('Invalid saved reference library.');
        state.references = (await (await request('/api/library/validate', { references: parsed.references })).json()).references;
      }
    } catch { showLibraryError('Saved library could not be loaded; starter examples are shown. The saved data has not been deleted.'); }
    initializeAngleControls();
    state.providers = new Map(configuration.providers.map(provider => [provider.id, provider]));
    for (const provider of configuration.providers) {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = `${provider.label}${provider.configured ? '' : ' (not configured)'}`;
      element('provider-select').append(option);
    }
    state.mode = configuration.defaultProvider;
    clearBrief();
  } catch (error) { element('form-error').textContent = error.message; element('form-error').hidden = false; }
}

initialize();