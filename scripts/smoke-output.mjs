import {mkdirSync} from 'node:fs';

// Browser smoke screenshots stay in the ignored, project-local runtime folder.
mkdirSync(new URL('../.runtime/outputs/', import.meta.url),{recursive:true});
