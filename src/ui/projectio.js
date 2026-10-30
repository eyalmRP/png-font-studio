// Title files (save / open) and automatic saving of the current title and fonts in this browser.
import { t } from './i18n.js';
import { toast, confirmDialog } from './controls.js';
import { state, emit, on, projectToJSON, projectFromJSON, addFont, checkpoint } from '../app/store.js';
import { projectToZip, projectFromZipBytes, saveFile, safeName } from '../storage/files.js';
import { saveProjectRecord, saveFontRecord } from '../storage/library.js';
import { pickFiles, debounce } from './dom.js';

export async function saveProject() {
  try {
    const json = projectToJSON();
    const used = new Set();
    for (const l of state.project.layers) for (const s of l.doc.styles) used.add(s.font || state.fontOrder[0]);
    const fonts = [...used].map((id) => state.fonts.get(id)).filter(Boolean);
    const zip = await projectToZip(json, fonts);
    const r = await saveFile(`${safeName(state.project.name, 'title')}.title.zip`, new Blob([zip], { type: 'application/zip' }));
    if (r === 'saved') toast(t('Title saved'), 'ok');
  } catch (e) { toast(e.message, 'error', 5000); }
}

export async function openProject(file) {
  const f = file || (await pickFiles({ accept: '.zip,application/zip', multiple: false }))[0];
  if (!f) return;
  try {
    const { project, fonts } = await projectFromZipBytes(await f.arrayBuffer());
    if (state.project.layers.length && !(await confirmDialog(t('Open title'), t('This replaces the title on the stage. You can undo it.'), t('Open')))) return;
    checkpoint('project', 'Open title');
    for (const font of fonts) if (!state.fonts.has(font.id)) { addFont(font, { select: false }); saveFontRecord(font); }
    state.project = projectFromJSON(project);
    state.selectedLayerId = null; state.edit = null; state.time = 0;
    emit('fonts'); emit('selection'); emit('project', { what: 'layout' });
    toast(t('Opened {name}', { name: f.name }), 'ok');
  } catch (e) { toast(e.message, 'error', 6000); }
}

export function startAutosave() {
  const saveP = debounce(() => { if (state.project) saveProjectRecord(projectToJSON()); }, 900);
  const dirtyFonts = new Set();
  const saveF = debounce(() => { for (const id of dirtyFonts) { const f = state.fonts.get(id); if (f) saveFontRecord(f); } dirtyFonts.clear(); }, 1200);
  on('project', saveP);
  on('selection', saveP);
  on('font', (f) => { if (f) { dirtyFonts.add(f.id); saveF(); } });
  window.addEventListener('pagehide', () => { if (state.project) saveProjectRecord(projectToJSON()); });
}
