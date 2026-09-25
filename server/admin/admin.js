const $ = selector => document.querySelector(selector);
const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const photoCount = count => `${count} photograph${count === 1 ? '' : 's'}`;
let csrf = '';
let content = { shoots: [], photos: [], collections: [] };
let selected = { type: 'shoot', id: '' };
let createType = 'shoot';
let collectionQuery = '';

function notice(message, error = false) {
  const el = $('#save-state');
  el.textContent = message;
  el.classList.toggle('error', error);
  if (message) setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, 6000);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (csrf && !['GET', 'HEAD'].includes(options.method || 'GET')) headers['X-CSRF-Token'] = csrf;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/admin${path}`, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function load() {
  content = await api('/content');
  if (selected.id && !(selected.type === 'shoot' ? content.shoots : content.collections).some(item => item.id === selected.id)) selected.id = '';
  if (!selected.id) {
    selected.type = 'shoot';
    selected.id = content.shoots[0]?.id || '';
  }
  render();
}

function render() {
  $('#shoot-list').innerHTML = content.shoots.map(shoot => `
    <button class="nav-item ${selected.type === 'shoot' && selected.id === shoot.id ? 'active' : ''}" data-select-shoot="${h(shoot.id)}" aria-current="${selected.type === 'shoot' && selected.id === shoot.id ? 'page' : 'false'}">
      ${shoot.coverUrl ? `<img class="nav-thumb" src="${h(shoot.coverUrl)}" alt="">` : '<span class="nav-monogram">N</span>'}
      <span class="nav-copy"><strong>${h(shoot.title)}</strong><small>${h(shoot.date || photoCount(shoot.photos.length))}</small></span>
      <span class="nav-status">${shoot.published ? 'Live' : 'Draft'}</span>
    </button>`).join('') || '<p class="muted">No shoots yet.</p>';
  $('#collection-list').innerHTML = content.collections.map(collection => `
    <button class="nav-item ${selected.type === 'collection' && selected.id === collection.id ? 'active' : ''}" data-select-collection="${h(collection.id)}" aria-current="${selected.type === 'collection' && selected.id === collection.id ? 'page' : 'false'}">
      ${collection.coverUrl ? `<img class="nav-thumb" src="${h(collection.coverUrl)}" alt="">` : '<span class="nav-monogram">C</span>'}<span class="nav-copy"><strong>${h(collection.title)}</strong><small>${photoCount(collection.photoIds.length)}</small></span>
      <span class="nav-status">${collection.published ? 'Live' : 'Draft'}</span>
    </button>`).join('') || '<p class="muted">No collections yet.</p>';
  const item = selected.type === 'shoot'
    ? content.shoots.find(entry => entry.id === selected.id)
    : content.collections.find(entry => entry.id === selected.id);
  const cover = $('#cover-preview');
  cover.hidden = !item?.coverUrl;
  if (item?.coverUrl) cover.src = item.coverUrl;
  else cover.removeAttribute('src');
  $('#selection-type').textContent = selected.type === 'shoot' ? 'SHOOT / EDIT' : 'COLLECTION / EDIT';
  $('#context-meta').textContent = item
    ? `${photoCount(selected.type === 'shoot' ? item.photos.length : item.photoIds.length)} · ${item.published ? 'Published' : 'Draft'}`
    : 'Shape the archive, one photograph at a time.';
  $('#editor').classList.toggle('collection-editor', selected.type === 'collection');
  if (selected.type === 'collection') renderCollection();
  else renderShoot();
}

function renderShoot() {
  const shoot = content.shoots.find(item => item.id === selected.id);
  $('#page-title').textContent = shoot?.title || 'Create the first shoot';
  if (!shoot) {
    $('#editor').innerHTML = '<div class="empty">Every photograph starts in a shoot. Choose <strong>+ New</strong> to make one.</div>';
    return;
  }
  const photos = content.photos.filter(photo => photo.shootId === shoot.id);
  $('#editor').innerHTML = `
    <div class="panel details-panel"><div class="panel-head"><div><span class="section-label">Shoot details</span><p class="panel-subtitle">The context shown alongside this work.</p></div><span class="pill ${shoot.published ? 'live' : ''}">${shoot.published ? 'Live' : 'Draft'}</span></div>
      <div class="panel-body"><form id="shoot-form" class="form-grid">
        <label class="field"><span class="field-label">Title</span><input name="title" value="${h(shoot.title)}" required maxlength="140"></label>
        <label class="field"><span class="field-label">Date or label</span><input name="date" value="${h(shoot.date)}" maxlength="80" placeholder="12 Sep 2026"></label>
        <label class="field"><span class="field-label">Location</span><input name="location" value="${h(shoot.location)}" maxlength="180"></label>
        <label class="field"><span class="field-label">Display order</span><input name="sortOrder" type="number" value="${shoot.sortOrder}"></label>
        <label class="field wide"><span class="field-label">Story or description</span><textarea name="description" maxlength="3000">${h(shoot.description)}</textarea></label>
        ${shoot.curated ? '<p class="hint field wide">This curated shoot is published from the site’s media manifest. Its visibility is managed with a redeploy.</p>' : ''}
        <div class="field wide toolbar">${shoot.curated ? '' : `<label class="check"><input name="published" type="checkbox" ${shoot.published ? 'checked' : ''}> Publish shoot</label><button class="danger" type="button" id="delete-shoot">Delete shoot</button>`}<button class="primary" type="submit">Save changes</button></div>
      </form></div></div>
    <div class="panel upload-panel"><div class="panel-head"><div><span class="section-label">Add photographs</span><p class="panel-subtitle">Edited exports only. RAWs stay private.</p></div></div><div class="panel-body">
      <form id="upload-form" class="upload">
        <label><span class="field-label">Image · up to 50 MB</span><input name="image" type="file" accept="image/jpeg,image/png,image/tiff,image/webp,image/avif,image/heic" required></label>
        <label><span class="field-label">Alt text</span><input name="alt" required placeholder="Describe what the photograph shows"></label>
        <label><span class="field-label">Caption <span class="optional">Optional</span></span><input name="caption" placeholder="A line for this frame"></label>
        <button class="primary" type="submit">Process image <span aria-hidden="true">↗</span></button>
      </form><p class="hint">The CMS makes responsive AVIF, WebP, and JPEG copies and removes private camera metadata. Uploads stay private until you publish each photo.</p>
    </div></div>
    <div class="panel photos-panel"><div class="panel-head"><div><span class="section-label">Photographs <span class="count">${photos.length}</span></span><p class="panel-subtitle">Choose a cover and publish selected frames.</p></div></div><div class="panel-body">
      ${photos.length ? `<div class="photo-grid">${photos.map(renderPhoto).join('')}</div>` : '<div class="empty">This shoot has no photos yet. Add an edited export above.</div>'}
    </div></div>`;
}

function renderPhoto(photo) {
  return `<article class="photo-card"><div class="photo-image"><img src="/api/admin/photos/${h(photo.id)}/preview" alt="${h(photo.alt)}" loading="lazy"></div>
    <form class="photo-form" data-photo-id="${h(photo.id)}">
      <div class="photo-meta">${photo.width} × ${photo.height} <span class="pill ${photo.published ? 'live' : ''}">${photo.curated ? 'Curated static' : photo.published ? 'Live' : 'Draft'}</span></div>
      <label>Alt text<input name="alt" value="${h(photo.alt)}" maxlength="400" required></label>
      <label>Caption<textarea name="caption" maxlength="1500">${h(photo.caption)}</textarea></label>
      <label>Order<input name="sortOrder" type="number" value="${photo.sortOrder}"></label>
      ${photo.curated ? '<p class="hint">This curated photograph is published from the site’s media manifest.</p>' : ''}
      <div class="inline-switches">${photo.curated ? '' : `<label class="check"><input name="published" type="checkbox" ${photo.published ? 'checked' : ''}> Publish</label>`}<label class="check"><input name="isCover" type="checkbox" ${photo.isCover ? 'checked' : ''}> Cover</label></div>
      <div class="photo-actions">${photo.curated ? '' : `<button class="danger" type="button" data-delete-photo="${h(photo.id)}">Delete</button>`}<button class="primary" type="submit">Save photo</button></div>
    </form></article>`;
}

function renderCollection() {
  const collection = content.collections.find(item => item.id === selected.id);
  $('#page-title').textContent = collection?.title || 'Collections';
  if (!collection) return;
  $('#editor').innerHTML = `<div class="panel details-panel"><div class="panel-head"><div><span class="section-label">Collection details</span><p class="panel-subtitle">Give this edit a name and context.</p></div><span class="pill ${collection.published ? 'live' : ''}">${collection.published ? 'Live' : 'Draft'}</span></div>
    <div class="panel-body"><form id="collection-form" class="form-grid">
      <label class="field"><span class="field-label">Title</span><input name="title" value="${h(collection.title)}" required maxlength="140"></label>
      <label class="field"><span class="field-label">Display order</span><input name="sortOrder" type="number" value="${collection.sortOrder}"></label>
      <label class="field wide"><span class="field-label">Description</span><textarea name="description" maxlength="3000">${h(collection.description)}</textarea></label>
      <div class="field wide toolbar"><label class="check"><input name="published" type="checkbox" ${collection.published ? 'checked' : ''}> Publish collection</label><button class="danger" type="button" id="delete-collection">Delete collection</button><button class="primary" type="submit">Save changes</button></div>
    </form></div></div>
    <div class="panel collection-panel"><div class="panel-head"><div><span class="section-label">Select photographs <span class="count">${collection.photoIds.length}</span></span><p class="panel-subtitle">A photograph can be in more than one collection.</p></div></div><div class="panel-body">
      ${content.photos.length ? `<label class="collection-search"><span class="field-label">Find a photograph</span><input id="collection-search" type="search" value="${h(collectionQuery)}" placeholder="Search by description or shoot"></label><div class="collection-checks">${content.photos.map(photo => {
        const shoot = content.shoots.find(item => item.id === photo.shootId);
        const search = `${photo.alt} ${shoot?.title || ''}`.toLowerCase();
        return `<label class="collection-photo" data-photo-search="${h(search)}" ${collectionQuery && !search.includes(collectionQuery.toLowerCase()) ? 'hidden' : ''}>
          <input type="checkbox" data-collection-photo="${h(photo.id)}" ${collection.photoIds.includes(photo.id) ? 'checked' : ''}>
          <img src="/api/admin/photos/${h(photo.id)}/preview" alt="" loading="lazy">
          <span class="collection-photo-copy"><strong>${h(photo.alt || photo.title || photo.id)}</strong><small>${h(shoot?.title || 'Unassigned')} · ${photo.published ? 'Live' : 'Draft'}</small></span>
        </label>`;
      }).join('')}</div><p id="collection-empty-search" class="muted" hidden>No photographs match this search.</p>` : '<div class="empty">Upload photographs to a shoot first.</div>'}
    </div></div>`;
}

function values(form) {
  const data = Object.fromEntries(new FormData(form));
  if (form.elements.published) data.published = form.elements.published.checked;
  if (form.elements.isCover) data.isCover = form.elements.isCover.checked;
  return data;
}

async function submit(action) {
  try { notice('Working…'); await action(); await load(); notice('Saved'); }
  catch (error) { notice(error.message, true); }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#login-message').textContent = 'Signing in…';
  try {
    const data = await api('/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    csrf = data.csrfToken;
    $('#password').value = '';
    await load();
    $('#login').hidden = true;
    $('#app').hidden = false;
  } catch (error) { $('#login-message').textContent = error.message; }
});

$('#logout').addEventListener('click', async () => {
  try {
    await api('/logout', { method: 'POST' });
    csrf = '';
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-message').textContent = '';
  } catch (error) { notice(error.message, true); }
});

function openCreateDialog(type) {
  createType = type;
  $('#create-title').textContent = type === 'shoot' ? 'New shoot' : 'New collection';
  $('#create-description').textContent = type === 'shoot'
    ? 'Give the shoot a name. You can add its story and photographs next.'
    : 'Name the edit. You can choose its photographs next.';
  $('#create-name').value = '';
  $('#create-error').textContent = '';
  $('#create-dialog').showModal();
  $('#create-name').focus();
}

$('#new-shoot').addEventListener('click', () => openCreateDialog('shoot'));
$('#new-collection').addEventListener('click', () => openCreateDialog('collection'));
$('#create-cancel').addEventListener('click', () => $('#create-dialog').close());
$('#create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const title = $('#create-name').value.trim();
  if (!title) return;
  const button = $('#create-form button[type="submit"]');
  button.disabled = true;
  $('#create-error').textContent = '';
  try {
    const path = createType === 'shoot' ? '/shoots' : '/collections';
    const result = await api(path, { method: 'POST', body: JSON.stringify({ title }) });
    selected = { type: createType, id: result.id };
    collectionQuery = '';
    $('#create-dialog').close();
    await load();
    window.scrollTo({ top: 0, behavior: 'auto' });
    notice('Created');
  } catch (error) { $('#create-error').textContent = error.message; }
  finally { button.disabled = false; }
});

document.addEventListener('click', event => {
  const shootButton = event.target.closest('[data-select-shoot]');
  const collectionButton = event.target.closest('[data-select-collection]');
  const deletePhoto = event.target.closest('[data-delete-photo]');
  if (shootButton) { selected = { type: 'shoot', id: shootButton.dataset.selectShoot }; collectionQuery = ''; render(); window.scrollTo({ top: 0, behavior: 'auto' }); }
  if (collectionButton) { selected = { type: 'collection', id: collectionButton.dataset.selectCollection }; collectionQuery = ''; render(); window.scrollTo({ top: 0, behavior: 'auto' }); }
  if (event.target.id === 'delete-shoot' && confirm('Delete this empty shoot?')) submit(() => api(`/shoots/${selected.id}`, { method: 'DELETE' }));
  if (event.target.id === 'delete-collection' && confirm('Delete this collection? Photos will remain in their shoots.')) submit(() => api(`/collections/${selected.id}`, { method: 'DELETE' }));
  if (deletePhoto && confirm('Permanently delete this photograph and its CMS copies?')) submit(() => api(`/photos/${deletePhoto.dataset.deletePhoto}`, { method: 'DELETE' }));
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (form.id === 'shoot-form') {
    event.preventDefault();
    submit(() => api(`/shoots/${selected.id}`, { method: 'PATCH', body: JSON.stringify(values(form)) }));
  }
  if (form.id === 'collection-form') {
    event.preventDefault();
    submit(() => api(`/collections/${selected.id}`, { method: 'PATCH', body: JSON.stringify(values(form)) }));
  }
  if (form.id === 'upload-form') {
    event.preventDefault();
    submit(() => {
      const data = new FormData(form);
      data.append('shootId', selected.id);
      return api('/photos/upload', { method: 'POST', body: data });
    });
  }
  if (form.matches('.photo-form')) {
    event.preventDefault();
    submit(() => api(`/photos/${form.dataset.photoId}`, { method: 'PATCH', body: JSON.stringify(values(form)) }));
  }
});

document.addEventListener('change', event => {
  const control = event.target.closest('[data-collection-photo]');
  if (!control) return;
  submit(() => api(`/collections/${selected.id}/photos/${control.dataset.collectionPhoto}`, { method: control.checked ? 'PUT' : 'DELETE', body: control.checked ? '{}' : undefined }));
});

document.addEventListener('input', event => {
  if (event.target.id !== 'collection-search') return;
  collectionQuery = event.target.value.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll('[data-photo-search]').forEach(item => {
    item.hidden = !item.dataset.photoSearch.includes(collectionQuery);
    if (!item.hidden) visible += 1;
  });
  $('#collection-empty-search').hidden = visible > 0;
});

try {
  const current = await api('/session');
  if (current.authenticated) {
    csrf = current.csrfToken;
    await load();
    $('#app').hidden = false;
  } else $('#login').hidden = false;
} catch (error) {
  $('#login').hidden = false;
  $('#login-message').textContent = error.message;
}
