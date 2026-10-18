import JSZip from 'jszip';
import type { Allocation, Card, NativeFile, Project, Rarity, Source } from './types.ts';
import { ALLOCATIONS, cardSnapshot, uid } from './types.ts';
import { EFFECTS } from './effects.ts';
import { createCard, createProject, parseProject } from './project.ts';
import { at, children, descendants, numberAt, parseXml, rawNode, value } from './xml.ts';
import { decodeText, normalizePath } from './catalog.ts';
import { safeRelative } from './paths.ts';
export { safeRelative } from './paths.ts';
export async function unzipMod(bytes:ArrayBuffer):Promise<NativeFile[]>{
 if(bytes.byteLength>250_000_000)throw new Error('ZIP 大于 250 MB，请解压后选择 Mod 文件夹');
 const zip=await JSZip.loadAsync(bytes),entries=Object.values(zip.files).filter(e=>!e.dir);
 if(entries.length>20000)throw new Error('压缩包文件过多');
 const names=entries.map(e=>normalizePath(e.name));let prefix='';const first=names[0]?.split('/')[0];if(first&&names.every(n=>n.startsWith(first+'/')))prefix=first+'/';
 let total=0;const out:NativeFile[]=[];
 for(const e of entries){const original=e.unsafeOriginalName??e.name;if(!safeRelative(normalizePath(original)))throw new Error('ZIP 含不安全的文件路径');const path=normalizePath(e.name).slice(prefix.length);if(!safeRelative(path))throw new Error('ZIP 文件路径无效');const data=await e.async('uint8array');total+=data.byteLength;if(total>500_000_000)throw new Error('解压内容超过 500 MB');let text='';for(let i=0;i<data.length;i+=32768)text+=String.fromCharCode(...data.subarray(i,i+32768));out.push({path,data:btoa(text)});}
 return out;
}
export function importMod(files:NativeFile[],mode:'collection'|'edit',into?:Project):{project:Project;messages:string[]} {
 if(files.some(f=>!safeRelative(normalizePath(f.path))))throw new Error('Mod 文件包含不安全路径');
 const embedded=files.find(f=>normalizePath(f.path)==='cardforge-project.json');
 if(embedded)return{project:parseProject(decodeText(embedded.data)),messages:['已恢复完整卡牌工坊工程和稳定身份']};
 const p=into?structuredClone(into):createProject(),messages:string[]=[],texts=new Map<number,string>(),english=new Map<number,string>();
 const docs=files.filter(f=>/\.xml$/i.test(f.path)).map(f=>({path:normalizePath(f.path),xml:decodeText(f.data)}));
 for(const f of docs.filter(f=>/texts_(chinese|english)\.xml$/i.test(f.path))){for(const n of descendants(parseXml(f.xml),'Text')){const g=numberAt(n,'GUID');if(g)(f.path.includes('chinese')?texts:english).set(g,value(n,'Text'));}}
 const parsed=docs.filter(f=>!/texts_/.test(f.path)).map(f=>({...f,doc:parseXml(f.xml)}));
 const allAssets=parsed.flatMap(f=>descendants(f.doc,'Asset').map(n=>({f,n,values:at(n,'Values')})));
 const cards:Card[]=[];
 for(const {f,n,values:v}of allAssets){
  const template=value(n,'Template');if(!['GuildhouseItem','TownhallItem','VehicleItem'].includes(template))continue;
  const oldGuid=numberAt(v,'Standard/GUID');if(!oldGuid)continue;
  if(cards.some(c=>c.origin&&c.guid===oldGuid)){messages.push(`同一 GUID ${oldGuid} 有多个定义，跳过后续定义`);continue;}
  const card=createCard(p,texts.get(oldGuid)||english.get(oldGuid)||value(v,'Text/LocaText/English/Text')||value(v,'Standard/Name')||`物品 ${oldGuid}`);
  const importedAllocation=value(v,'Item/Allocation') as Allocation;
  card.allocation=importedAllocation in ALLOCATIONS?importedAllocation:template==='TownhallItem'?'TownHall':template==='VehicleItem'?'Ship':'GuildHouse';
  card.english=english.get(oldGuid)||value(v,'Text/LocaText/English/Text');card.rarity=(value(v,'Item/Rarity')||'Rare')as Rarity;
  card.price=numberAt(v,'Item/TradePrice',0);card.stack=numberAt(v,'Item/MaxStackSize',1);card.itemType=value(v,'Item/ItemType')==='Normal'?'Normal':'Specialist';
  const desc=numberAt(v,'Standard/InfoDescription');card.description=texts.get(desc)||english.get(desc)||'';card.englishDescription=english.get(desc)||'';
  card.targets=children(at(v,'ItemEffect/EffectTargets'),'Item').map(i=>numberAt(i,'GUID')).filter(Boolean);
  card.group='导入卡牌';card.image.path=value(v,'Standard/IconFilename');
  const image=files.find(f=>normalizePath(f.path)===card.image.path&&/\.(png|jpe?g|webp)$/i.test(f.path));if(image)card.image={mode:'custom',path:card.image.path,data:`data:image/${image.path.endsWith('.png')?'png':image.path.endsWith('.webp')?'webp':'jpeg'};base64,${image.data}`};
  const unsupported:string[]=[];
  for(const d of EFFECTS){const node=at(v,d.path);if(!node)continue;
   if(d.encoding==='upgrade'&&d.scale&&numberAt(node,'Percental')===1){unsupported.push(`${d.path}（采用不同风险单位，原文保留）`);continue;}
   const nodes=d.repeat?children(node,'Item'):[node];
   for(const source of nodes){let params:Record<string,number|boolean>={};
    if(d.encoding==='upgrade')params={value:numberAt(source,'Value')/(d.scale??1)};
    if(d.encoding==='scalar')params={[d.params[0].key]:d.params[0].kind==='boolean'?value(source)==='1':Number(value(source))};
    if(d.encoding==='output')params={product:numberAt(source,'Product'),cycles:numberAt(source,'AdditionalOutputCycle',1),amount:numberAt(source,'Amount',1)};
    if(d.encoding==='replace')params={old:numberAt(source,'OldInput'),new:numberAt(source,'NewInput')};
    if(d.encoding==='consumption')params={need:numberAt(source,'ProvidedNeed'),value:numberAt(source,'AmountInPercent')};
    if(d.encoding==='need')params={provided:numberAt(source,'ProvidedNeed'),substitute:numberAt(source,'SubstituteNeed')};
    card.effects.push({id:uid(),type:d.id,enabled:true,params});
   }
  }
  const knownPaths=new Set(['Standard/GUID','Standard/Name','Standard/IconFilename','Standard/InfoDescription','Text','Item/MaxStackSize','Item/Rarity','Item/ItemType','Item/Allocation','Item/TradePrice','Item/TradePriceOnlineCurrency','ItemEffect/EffectTargets',...EFFECTS.map(d=>d.path)]);
  const walk=(node:NonNullable<typeof v>,path:string)=>{if(knownPaths.has(path)||(!node.children.length&&!node.text.trim()))return;if(!node.children.length){unsupported.push(path);return;}for(const ch of node.children)walk(ch,path?`${path}/${ch.name}`:ch.name);};if(v)for(const ch of v.children)walk(ch,ch.name);
  for(const {f:opFile}of allAssets.filter(a=>value(a.n,'Template')==='ScenarioWorkshopItem'&&numberAt(a.values,'ScenarioWorkshopItem/AssetReference')===oldGuid)){
   const permit=allAssets.find(a=>a.f===opFile&&value(a.n,'Template')==='ScenarioWorkshopItem'&&numberAt(a.values,'ScenarioWorkshopItem/AssetReference')===oldGuid);
   if(!permit)continue;const permitGuid=numberAt(permit.values,'Standard/GUID');const pack=allAssets.find(a=>value(a.n,'Template')==='ScenarioWorkshopPackage'&&descendants(a.n,'ScenarioWorkshopItem').some(x=>Number(x.text.trim())===permitGuid));
   if(pack){const source:Source={id:uid(),type:'gallery',label:'壮丽艺廊',poolGuid:0,weight:100,tickets:numberAt(pack.values,'ScenarioWorkshopPackage/RubberDots',100),maxCount:numberAt(pack.values,'ScenarioWorkshopPackage/PackageMaxCount',99),scale:numberAt(pack.values,'ScenarioWorkshopPackage/PackageRubberDotScaleFactor',1.5)};card.sources.push(source);if(mode==='edit'){card.galleryPermitGuid=permitGuid;card.galleryPackageGuid=numberAt(pack.values,'Standard/GUID');}break;}
  }
  for(const file of parsed){for(const op of descendants(file.doc,'ModOp')){if(op.attrs.Type!=='add'||!op.attrs.Path?.includes('RewardPool/ItemsPool'))continue;for(const item of children(op,'Item')){if(numberAt(item,'ItemLink')!==oldGuid)continue;for(const g of (op.attrs.GUID??'').split(',').map(Number).filter(Boolean))card.sources.push({id:uid(),type:'trader',label:`导入物品池 ${g}`,poolGuid:g,weight:numberAt(item,'Weight',100),tickets:100,maxCount:99,scale:1.5});}}}
  if(mode==='edit'){card.guid=oldGuid;if(desc&&desc!==oldGuid)card.descriptionGuid=desc;card.published=true;card.origin={file:f.path,raw:rawNode(f.xml,n),baseline:'',nameGuid:oldGuid,unsupported:[...new Set(unsupported)]};card.origin.baseline=cardSnapshot(card);}
  else if(unsupported.length){messages.push(`${card.name} 含 ${unsupported.length} 个未支持字段，已跳过；可用“编辑原 Mod 副本”读取`);continue;}
  cards.push(card);
 }
 if(!cards.length)throw new Error('未找到可导入的卡牌定义。若此 Mod 只通过补丁修改原版物品，请先读取游戏基线；复杂条件补丁保留在原文件中。');
 if(mode==='edit'){
  if(into?.cards.length)throw new Error('原 Mod 副本需要独立工程，请先保存当前工程');
  p.mode='edit';p.importedFiles=files;
  const info=files.find(f=>f.path==='modinfo.json');if(info){const m=JSON.parse(decodeText(info.data));p.modId=String(m.ModID||p.modId);p.name=String(m.ModName?.Chinese||m.ModName?.English||p.name);p.version=String(m.Version||p.version);p.folderName=p.name.replace(/[<>:"/\\|?*]/g,'_');p.dependencies=Array.isArray(m.ModDependencies)?m.ModDependencies.filter((v:unknown)=>typeof v==='string'):[];}
 }
 p.cards.push(...cards);p.reservedGuids=[...new Set([...p.reservedGuids,...cards.flatMap(c=>[c.guid,c.descriptionGuid,c.galleryPermitGuid,c.galleryPackageGuid])])];
 messages.push(`已读取 ${cards.length} 张卡牌${mode==='edit'?'，保留原 GUID 和其他文件':'，分配新身份加入合集'}`);
 if(parsed.some(f=>descendants(f.doc,'ModOp').some(op=>op.attrs.Type==='replace'||op.attrs.Condition)))messages.push('包含补丁修改／条件逻辑：未解析为表单的内容仅在原 Mod 副本中保留');
 return{project:p,messages};
}
