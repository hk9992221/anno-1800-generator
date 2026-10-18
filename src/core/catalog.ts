import type { Asset, Catalog, NativeFile } from './types.ts';
import { at, children, descendants, numberAt, parseXml, value } from './xml.ts';
import starter from '../data/starter-assets.json' with {type:'json'};
export const starterCatalog:Catalog={version:'Anno 1800 / Starter references',source:'内置常用 GUID 参考（完整配方与头像需读取本机资源）',fingerprint:'starter-v1',indexedAt:'',assets:starter as Asset[]};
export const catalogOf=(catalog?:Catalog)=>catalog??starterCatalog;
export const lookupAsset=(catalog:Catalog|undefined,guid:number)=>catalogOf(catalog).assets.find(a=>a.guid===guid);
export const assetName=(catalog:Catalog|undefined,guid:number)=>lookupAsset(catalog,guid)?.name||`GUID ${guid||'未选择'}`;
export const decodeText=(base64:string)=>new TextDecoder().decode(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));
export const encodeText=(text:string)=>{const bytes=new TextEncoder().encode(text);let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
export const normalizePath=(path:string)=>path.replaceAll('\\','/').replace(/^\.\//,'');
export function indexFiles(files:NativeFile[],source='本机资源'):Catalog {
 const texts=new Map<number,string>();
 const docs=files.filter(f=>/\.xml$/i.test(f.path)).map(f=>({path:normalizePath(f.path),text:decodeText(f.data)}));
 for(const f of docs.filter(f=>/texts_chinese\.xml$/i.test(f.path))){for(const n of descendants(parseXml(f.text),'Text')){const g=numberAt(n,'GUID');if(g)texts.set(g,value(n,'Text'));}}
 const assets=new Map<number,Asset>();
 for(const f of docs.filter(f=>!/texts_/.test(f.path))){const doc=parseXml(f.text);
  for(const a of descendants(doc,'Asset')){const v=at(a,'Values'),guid=numberAt(v,'Standard/GUID');if(!guid)continue;
   const template=value(a,'Template'),internal=value(v,'Standard/Name');
   let kind:Asset['kind']='other';
   if(at(v,'Factory')||/Factory|Farm|Mine|Fishery|Production/.test(template))kind='building';
   if(/Residence/.test(template))kind='residence';
   if(/Ship|Airship/.test(template)&&!at(v,'Item'))kind='ship';
   if(template==='Product')kind=/workforce/i.test(internal)?'workforce':'product';
   if(/RewardPool|ItemEffectTargetPool|AssetPool/.test(template))kind='pool';
   if(at(v,'Item')||template==='Portrait')kind='portrait';
   const capabilities:string[]=[];
   for(const tag of ['Factory','Building','Residence','ModuleOwner','Industrializable','IncidentInfectable','Vehicle','Attacker','Attackable','TradeShip'])if(at(v,tag))capabilities.push(tag);
   const inputs=children(at(v,'Factory/FactoryInputs'),'Item').map(i=>numberAt(i,'Product')).filter(Boolean);
   const members=descendants(at(v,'ItemEffectTargetPool')??at(v,'RewardPool')??at(v,'AssetPool')??{...doc,children:[]},'Item').map(i=>numberAt(i,'GUID')||numberAt(i,'ItemLink')||numberAt(i,'Asset')).filter(Boolean);
   const english=value(v,'Text/LocaText/English/Text')||internal;
   assets.set(guid,{guid,name:texts.get(guid)||english,english,template,kind,icon:value(v,'Standard/IconFilename')||undefined,region:value(v,'Building/AssociatedRegions')||undefined,source,members:members.length?members:undefined,inputs:capabilities.includes('Factory')?inputs:undefined,capabilities,poolPath:at(v,'RewardPool')?'RewardPool/ItemsPool':at(v,'AssetPool')?'AssetPool/AssetList':undefined});
  }
 }
 if(!assets.size)throw new Error('没有找到含 Standard/GUID 的资源定义，请选择已解包资源根目录或正确的 XML');
 return {version:'本机 Anno 1800 资源',source,fingerprint:`${assets.size}:${files.map(f=>f.data.length).reduce((a,b)=>a+b,0)}`,indexedAt:new Date().toISOString(),assets:[...assets.values()]};
}
export function expandTargets(catalog:Catalog,guids:number[]):number[]{const out=new Set<number>(),visiting=new Set<number>();const walk=(g:number)=>{if(visiting.has(g))throw new Error(`目标池循环引用：${g}`);const a=catalog.assets.find(a=>a.guid===g);if(a?.members?.length){visiting.add(g);a.members.forEach(walk);visiting.delete(g);}else out.add(g);};guids.forEach(walk);return [...out];}
