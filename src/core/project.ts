import type { Card, Catalog, Project } from './types.ts';
import { cardSnapshot, uid } from './types.ts';
export const PRIVATE_START=2001000000, PRIVATE_END=2001009999;
export function createProject():Project {return{schemaVersion:1,projectId:uid(),name:'我的自定义卡牌',modId:'anno1800-cardforge-custom-cards',folderName:'[Gameplay] Anno1800 Custom Cards',zipName:'Anno1800-Custom-Cards.zip',version:'1.0.0',guidRange:{start:PRIVATE_START,end:PRIVATE_END,next:PRIVATE_START},reservedGuids:[],cards:[],dependencies:[],dlcs:[],mode:'collection',importedFiles:[],createdAt:new Date().toISOString()};}
export function allocate(p:Project,count:number,seed=uid()):number[]{
 const {start,end}=p.guidRange;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<1337471142||end>2147483647||end<start)throw new Error('GUID 范围必须在游戏允许的 Mod 整数范围内');
 const used=new Set([...p.reservedGuids,...p.cards.flatMap(c=>[c.guid,c.descriptionGuid,c.galleryPermitGuid,c.galleryPackageGuid]),...(p.catalog?.assets.map(a=>a.guid)??[]),...(p.catalog?.scannedModGuids??[])]);
 let hash=2166136261;for(const ch of seed){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619)>>>0;}
 const width=end-start+1,result:number[]=[];let offset=hash%width,examined=0;
 while(result.length<count){if(examined++>=width)throw new Error('GUID 范围不足，请在工程设置中检查范围');const next=start+offset;offset=(offset+1)%width;if(!used.has(next)){result.push(next);used.add(next);}}
 p.guidRange.next=start+offset;p.reservedGuids=[...new Set([...p.reservedGuids,...result])];return result;
}
export function createCard(p:Project,name='未命名专家'):Card {const id=uid();const [guid,descriptionGuid,galleryPermitGuid,galleryPackageGuid]=allocate(p,4,id);return{id,guid,descriptionGuid,galleryPermitGuid,galleryPackageGuid,name,english:'',subtitle:'',description:'',englishDescription:'',rarity:'Epic',allocation:'GuildHouse',itemType:'Specialist',price:150000,stack:1,group:'我的卡牌',notes:'',status:'active',published:false,image:{mode:'game',path:'data/ui/2kimages/main/3dicons/specialists/systemic/icon_farmer_403.png'},targets:[],effects:[],sources:[]};}
export function cloneCard(p:Project,card:Card,name=`${card.name} · 副本`):Card {
 if(card.origin?.unsupported.length)throw new Error('这张外部卡牌含未知字段，请先使用原 Mod 副本模式，避免复制后留下错误的内部引用');
 const next=createCard(p,name);return{...structuredClone(card),...Object.fromEntries(['id','guid','descriptionGuid','galleryPermitGuid','galleryPackageGuid'].map(k=>[k,next[k as keyof Card]])),name,published:false,origin:undefined,effects:card.effects.map(e=>({...structuredClone(e),id:uid()})),sources:card.sources.map(s=>({...s,id:uid()}))} as Card;
}
export function parseProject(input:string):Project {
 const p=JSON.parse(input) as Project;
 if(p.schemaVersion!==1)throw new Error('不支持此工程版本，请使用更新版本的卡牌工坊');
 if(!p.projectId||!Array.isArray(p.cards)||!p.guidRange||!Array.isArray(p.reservedGuids)||!p.modId||!p.folderName||!Array.isArray(p.importedFiles)||p.cards.length>10000)throw new Error('工程文件结构不完整');
 for(const c of p.cards){if(!c.id||!Number.isInteger(c.guid)||!Array.isArray(c.effects)||!Array.isArray(c.targets)||!Array.isArray(c.sources)||!c.image)throw new Error('卡牌数据不完整');}
 return p;
}
export const adoptCatalog=(p:Project,c:Catalog):Project=>({...p,catalog:c});
export function baselineCard(c:Card){if(c.origin)c.origin.baseline=cardSnapshot(c);}
