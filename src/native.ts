import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Catalog, ExportPlan, NativeFile, Project } from './core/types.ts';
import { bytesToBase64 } from './core/images.ts';
export const isDesktop=()=> '__TAURI_INTERNALS__'in window;
export interface ExportPreview {path:string;token:string;changes:{path:string;kind:string}[];}
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('cardforge-local',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function browserDraft(value?:string):Promise<string|undefined>{const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('drafts',value===undefined?'readonly':'readwrite');const r=value===undefined?t.objectStore('drafts').get('current'):t.objectStore('drafts').put(value,'current');r.onerror=()=>reject(r.error);t.oncomplete=()=>{d.close();resolve(value??r.result);};});}
export function download(name:string,bytes:Uint8Array){const blob=new Blob([new Uint8Array(bytes).buffer]);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
export const native={
 async chooseFolder(write=false){if(!isDesktop())throw new Error('目录读取／部署请使用 Windows 桌面程序；开发预览可打开工程或导入 ZIP');return invoke<string|null>('choose_folder',{write});},
 async openProject(){return invoke<{path:string;text:string}|null>('load_project');},
 async saveProject(p:Project,saveAs=false){const text=JSON.stringify(p,null,2);if(isDesktop())return invoke<string|null>('save_project',{text,saveAs});download('project.anno1800.json',new TextEncoder().encode(text));return 'project.anno1800.json';},
 async clearProjectPath(){if(isDesktop())await invoke('clear_project_path');},
 async draft(p:Project){const text=JSON.stringify(p);if(isDesktop())await invoke('save_draft',{text});else await browserDraft(text);},
 async loadDraft(){return isDesktop()?invoke<string|null>('load_draft'):browserDraft();},
 async registry(){return isDesktop()?invoke<number[]>('load_registry'):[];},
 async scanMods(path:string){return invoke<{assets:Catalog['assets'];guids:number[]}>('scan_mods',{path});},
 async readMod(path:string){return invoke<NativeFile[]>('read_mod_folder',{path});},
 async preview(parent:string,plan:ExportPlan){return invoke<ExportPreview>('preview_export',{parent,plan});},
 async write(parent:string,plan:ExportPlan,token:string){return invoke<string>('write_export',{parent,plan,token});},
 async zip(name:string,bytes:Uint8Array){if(isDesktop())return invoke<string|null>('save_zip',{name,data:bytesToBase64(bytes)});download(name,bytes);return name;},
 async restore(parent:string,p:Project){return invoke<string>('restore_export',{parent,projectId:p.projectId,folderName:p.folderName});},
 async index(path:string){return invoke<Catalog>('index_resources',{path});},
 async loadCatalog(){return isDesktop()?invoke<Catalog|null>('load_catalog'):null;},
 async cancelIndex(){if(isDesktop())await invoke('cancel_index');},
 async portrait(path:string){if(!isDesktop())return null;return invoke<string>('load_portrait',{path});},
 async progress(handler:(message:string)=>void){return isDesktop()?listen<string>('resource-progress',e=>handler(e.payload)):()=>{};},
};
