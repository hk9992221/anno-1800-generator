import JSZip from 'jszip';
import type { Card, ExportPlan, Project } from './types.ts';
import { cardSnapshot, familyOf } from './types.ts';
import { effectDef } from './effects.ts';
import { at, children, descendants, element as el, escapeXml, numberAt, parseXml, patchXml, textElement as t } from './xml.ts';
import { decodeText, encodeText, lookupAsset } from './catalog.ts';
import { iconFiles } from './images.ts';
import { validateProject } from './validate.ts';
export const ASSETS_PATH='data/config/export/main/asset/assets.xml';
const OP=(type:string,guid:number,path:string,body:string)=>`<ModOp Type="${type}" GUID="${guid}"${path?` Path="${escapeXml(path)}"`:''}>${body}</ModOp>`;
export function cardFields(card:Card):Record<string,string> {
 const name=card.name+(card.subtitle?`, ${card.subtitle}`:'');
 const out:Record<string,string>={
  'Template':escapeXml(familyOf(card.allocation)==='ship'?'VehicleItem':card.allocation==='TownHall'?'TownhallItem':'GuildhouseItem'),
  'Values/Standard/GUID':String(card.guid),'Values/Standard/Name':escapeXml(name),
  'Values/Standard/IconFilename':escapeXml(card.image.mode==='custom'?`data/graphics/cardforge/icons/icon_${card.guid}.png`:card.image.path),
  'Values/Standard/InfoDescription':String(card.descriptionGuid),
  'Values/Text/LocaText/English/Text':escapeXml(card.english||name),
  'Values/Item/MaxStackSize':String(card.stack),'Values/Item/Rarity':card.rarity,'Values/Item/ItemType':card.itemType,
  'Values/Item/Allocation':card.allocation,'Values/Item/TradePrice':String(card.price),
  'Values/ItemEffect/EffectTargets':card.targets.map(g=>el('Item',t('GUID',g))).join(''),
 };
 const groups=new Map<string,string[]>();
 for(const e of card.effects.filter(e=>e.enabled)){const d=effectDef(e.type);if(!d)throw new Error(`未知效果 ${e.type}`);const p=e.params;let body='';
  switch(d.encoding){
   case'upgrade':body=t('Value',Number(p.value)*(d.scale??1))+(d.scale?'':t('Percental',1));break;
   case'scalar':body=escapeXml(d.params[0]?.kind==='boolean'?(p.value?1:0):(p[d.params[0].key]??0));break;
   case'output':body=el('Item',t('Product',p.product)+t('AdditionalOutputCycle',p.cycles)+t('Amount',p.amount));break;
   case'replace':body=el('Item',t('OldInput',p.old)+t('NewInput',p.new));break;
   case'consumption':body=el('Item',t('ProvidedNeed',p.need)+t('AmountInPercent',p.value));break;
   case'need':body=el('Item',t('ProvidedNeed',p.provided)+t('SubstituteNeed',p.substitute));break;
  }
  const path=`Values/${d.path}`;if(!groups.has(path))groups.set(path,[]);groups.get(path)!.push(body);
 }
 for(const [path,bodies]of groups)out[path]=bodies.join('');return out;
}
export function compileAsset(card:Card):string {
 if(card.origin?.baseline===cardSnapshot(card))return card.origin.raw;
 const next=cardFields(card);
 if(card.origin){const baseline=JSON.parse(card.origin.baseline) as Card;const before=cardFields(baseline),updates:Record<string,string|null>={};for(const k of new Set([...Object.keys(before),...Object.keys(next)]))if(before[k]!==next[k])updates[`Asset/${k}`]=next[k]??null;return patchXml(card.origin.raw,updates);}
 return patchXml('<Asset></Asset>',Object.fromEntries(Object.entries(next).map(([path,body])=>[`Asset/${path}`,body])));
}
export function compileChannels(card:Card,p:Project):string {
 if(card.status!=='active')return '';
 return card.sources.map(s=>{
  if(s.type==='gallery'){
   const permit=el('Asset',t('Template','ScenarioWorkshopItem')+el('Values',el('Standard',t('GUID',card.galleryPermitGuid)+t('Name',`CardForge_Permit_${card.guid}`))+el('ScenarioWorkshopItem',t('AssetReference',card.guid)+t('BuildPermits',1))));
   const pack=el('Asset',t('Template','ScenarioWorkshopPackage')+el('Values',el('Standard',t('GUID',card.galleryPackageGuid)+t('Name',`CardForge_Gallery_${card.guid}`))+el('ScenarioWorkshopPackage',el('ScenarioWorkshopItems',el('Item',t('ScenarioWorkshopItem',card.galleryPermitGuid)))+t('RubberDots',s.tickets)+t('PackageRubberDotScaleFactor',s.scale)+t('PackageMaxCount',s.maxCount)+t('PackageDescription',0)+t('PackageFluffText',0))));
   return OP('addNextSibling',8550,'',permit)+OP('addNextSibling',8594,'',pack)+OP('addNextSibling',1252,"/Values/ScenarioWorkshopScene/ScenarioWorkshopCategories/Items/ScenarioWorkshopCategory/Item[ScenarioWorkshopPackage='4305']",el('Item',t('ScenarioWorkshopPackage',card.galleryPackageGuid)));
  }
  const pool=lookupAsset(p.catalog,s.poolGuid),path=pool?.poolPath??'RewardPool/ItemsPool';
  return OP('add',s.poolGuid,`/Values/${path}`,el('Item',t(path.startsWith('AssetPool')?'Asset':'ItemLink',card.guid)+(path.startsWith('RewardPool')?t('Weight',s.weight):'')));
 }).join('\n');
}
function compileText(cards:Card[],english:boolean):string{return el('ModOps',`<ModOp Type="add" Path="/TextExport/Texts">${cards.map(c=>el('Text',t('GUID',c.guid)+t('Text',english?(c.english||c.name)+(c.subtitle?`, ${c.subtitle}`:''):c.name+(c.subtitle?`，${c.subtitle}`:'')))+el('Text',t('GUID',c.descriptionGuid)+t('Text',english?(c.englishDescription||c.description):c.description))).join('')}</ModOp>`);}
export function compileXml(p:Project):{assets:string;chinese:string;english:string} {
 const cards=p.cards.filter(c=>c.status!=='draft').sort((a,b)=>a.guid-b.guid);
 return{assets:el('ModOps',cards.map(c=>OP('addNextSibling',191431,'',compileAsset(c))+compileChannels(c,p)).join('\n')),chinese:compileText(cards,false),english:compileText(cards,true)};
}
function patchImportedFiles(p:Project,files:Map<string,string>):void {
 for(const file of p.importedFiles){if(!/\.xml$/i.test(file.path)||/texts_/.test(file.path))continue;
  let xml=decodeText(file.data);const doc=parseXml(xml);const edits:{start:number;end:number;text:string}[]=[];
  for(const node of descendants(doc,'Asset')){const guid=numberAt(at(node,'Values'),'Standard/GUID');const c=p.cards.find(c=>c.guid===guid&&c.origin?.file===file.path);if(c&&c.status!=='draft'&&c.origin?.baseline!==cardSnapshot(c))edits.push({start:node.start,end:node.end,text:compileAsset(c)});}
  for(const e of edits.sort((a,b)=>b.start-a.start))xml=xml.slice(0,e.start)+e.text+xml.slice(e.end);if(edits.length)files.set(file.path,encodeText(xml));
 }
 // Text edits preserve all unrelated entries and update their original GUIDs.
 for(const language of ['chinese','english']){const path=`data/config/gui/texts_${language}.xml`;const existing=files.get(path);let xml=existing?decodeText(existing):'<ModOps></ModOps>';const doc=parseXml(xml),edits:{start:number;end:number;text:string}[]=[],append:string[]=[];
  for(const c of p.cards.filter(c=>c.origin&&c.status!=='draft')){const baseline=JSON.parse(c.origin!.baseline)as Card;const en=language==='english';const entries:[[number,string,string],[number,string,string]]=[[c.origin!.nameGuid||c.guid,en?(c.english||c.name):c.name,en?(baseline.english||baseline.name):baseline.name],[c.descriptionGuid,en?(c.englishDescription||c.description):c.description,en?(baseline.englishDescription||baseline.description):baseline.description]];
   for(const [guid,text,old]of entries){if(text===old)continue;const n=descendants(doc,'Text').find(n=>numberAt(n,'GUID')===guid);const raw=el('Text',t('GUID',guid)+t('Text',text));if(n)edits.push({start:n.start,end:n.end,text:raw});else append.push(raw);}
  }
  for(const e of edits.sort((a,b)=>b.start-a.start))xml=xml.slice(0,e.start)+e.text+xml.slice(e.end);
  if(append.length){const root=children(parseXml(xml),'ModOps')[0];if(!root)throw new Error('外部文本文件不是可编辑的 ModOps');xml=xml.slice(0,root.closeStart)+`<ModOp Type="add" Path="/TextExport/Texts">${append.join('')}</ModOp>`+xml.slice(root.closeStart);}
  if(edits.length||append.length)files.set(path,encodeText(xml));
 }
}
export async function createExportPlan(p:Project):Promise<ExportPlan>{
 const errors=validateProject(p).filter(i=>i.severity==='error');if(errors.length)throw new Error(errors.slice(0,4).map(i=>i.message).join('\n'));
 const xml=compileXml(p),files=new Map(p.mode==='edit'?p.importedFiles.map(f=>[f.path,f.data]):[]);
 if(p.mode==='edit'){
  patchImportedFiles(p,files);
  for(const c of p.cards.filter(c=>c.origin&&c.origin.baseline!==cardSnapshot(c))){const b=JSON.parse(c.origin!.baseline)as Card;if(JSON.stringify(b.sources)!==JSON.stringify(c.sources)||b.status!==c.status)throw new Error('外部 Mod 副本中的获取渠道／发布状态暂时保留原文。请复制为新卡后修改渠道。');}
  const fresh=p.cards.filter(c=>!c.origin&&c.status!=='draft');if(fresh.length){const subset={...p,cards:fresh,mode:'collection' as const};const extra=compileXml(subset);const existing=files.get(ASSETS_PATH);let source=existing?decodeText(existing):'<ModOps></ModOps>';const root=children(parseXml(source),'ModOps')[0];if(!root)throw new Error('无法向外部配置追加卡牌');source=source.slice(0,root.closeStart)+extra.assets.slice('<ModOps>'.length,-'</ModOps>'.length)+source.slice(root.closeStart);files.set(ASSETS_PATH,encodeText(source));for(const [lang,text]of [['chinese',extra.chinese],['english',extra.english]]){const path=`data/config/gui/texts_${lang}.xml`;const old=files.get(path);if(old){const src=decodeText(old),r=children(parseXml(src),'ModOps')[0];files.set(path,encodeText(src.slice(0,r.closeStart)+text.slice(8,-9)+src.slice(r.closeStart)));}else files.set(path,encodeText(text));}}
 }else{files.set(ASSETS_PATH,encodeText(xml.assets));files.set('data/config/gui/texts_chinese.xml',encodeText(xml.chinese));files.set('data/config/gui/texts_english.xml',encodeText(xml.english));}
 if(!files.has('modinfo.json'))files.set('modinfo.json',encodeText(JSON.stringify({ModID:p.modId,Version:p.version,ModName:{English:p.name,Chinese:p.name},Category:{English:'Gameplay',Chinese:'游戏玩法'},Description:{English:'Custom items created with Anno 1800 CardForge.'},ModDependencies:p.dependencies},null,2)));
 for(const c of p.cards.filter(c=>c.status!=='draft'))for(const f of await iconFiles(c.image,c.guid))files.set(f.path,f.data);
 // The embedded editor project makes our own ZIP/folder output fully reopenable.
 files.set('cardforge-project.json',encodeText(JSON.stringify({...p,cards:p.cards.map(c=>({...c,published:c.status!=='draft'||c.published}))})));
 for(const [path,data]of files){if(path==='cardforge-project.json')continue;if(/\.xml$/i.test(path))parseXml(decodeText(data));}
 return{projectId:p.projectId,modId:p.modId,folderName:p.folderName,files:[...files].sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,data])=>({path,data})),cardGuids:p.cards.filter(c=>c.status!=='draft').map(c=>c.guid)};
}
export async function planToZip(plan:ExportPlan):Promise<Uint8Array>{const zip=new JSZip();for(const file of plan.files)zip.file(`${plan.folderName}/${file.path}`,file.data,{base64:true,date:new Date('2020-01-01T00:00:00Z')});return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6},platform:'DOS'});}
