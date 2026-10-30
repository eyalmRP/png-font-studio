// ag-psd as its own script, loaded only when a font goes to or comes back from Photoshop (src/ui/fonts/psd.js).
import { readPsd, writePsd } from 'ag-psd';

window.__pfsPSD = { readPsd, writePsd };
