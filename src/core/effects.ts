import type { Effect, Family } from './types.ts';
import { uid } from './types.ts';
import { V11_EFFECTS } from './effects-v11.ts';
import { V12_EFFECTS } from './effects-v12.ts';
export interface ParamDef {key:string;label:string;kind:'number'|'product'|'workforce'|'need'|'boolean';unit?:string;default:number|string|boolean;min?:number;max?:number;step?:number;}
export interface EffectDef {id:string;label:string;group:string;families:Family[];version:string;params:ParamDef[];path:string;encoding:'upgrade'|'scalar'|'output'|'replace'|'consumption'|'need';repeat?:boolean;scale?:number;percental?:boolean;help:string;}
const n=(key:string,label:string,def:number,unit='%',min=-100,max=10000,step=1):ParamDef=>({key,label,kind:'number',default:def,unit,min,max,step});
const g=(key:string,label:string,kind:'product'|'workforce'|'need',def=0):ParamDef=>({key,label,kind,default:def});
export const EFFECTS:EffectDef[]=[
 {id:'productivity',label:'生产率',group:'生产',families:['production'],version:'1.0',params:[n('value','生产率修正',50,'%',-99)],path:'FactoryUpgrade/ProductivityUpgrade',encoding:'upgrade',help:'生产率的百分比修正；无其他修正时，+50% 将 100% 提升至 150%。'},
 {id:'workforce',label:'劳动力需求',group:'生产',families:['production'],version:'1.0',params:[n('value','需求修正',-25)],path:'BuildingUpgrade/WorkforceAmountUpgrade',encoding:'upgrade',help:'负数减少工厂需要的人数，与居民提供劳动力的效果分别计算。'},
 {id:'workforceType',label:'替代劳动力阶层',group:'生产',families:['production'],version:'1.0',params:[g('workforce','替换为','workforce')],path:'BuildingUpgrade/ReplacingWorkforce',encoding:'scalar',help:'以选定劳动力资源替换工厂原有阶层；需检查地区和建筑兼容性。'},
 {id:'maintenance',label:'建筑维护费',group:'成本',families:['production','residence'],version:'1.0',params:[n('value','维护费修正',-20)],path:'BuildingUpgrade/MaintenanceUpgrade',encoding:'upgrade',help:'持续维护成本的修正，卡牌买价在基本信息中设置。'},
 {id:'fire',label:'火灾风险',group:'灾害',families:['production','residence'],version:'1.0',params:[n('value','风险修正',-50,'%',-100,100,10)],path:'IncidentInfectableUpgrade/IncidentFireIncreaseUpgrade',encoding:'upgrade',scale:0.1,help:'以游戏风险等级换算：界面 -50 对应内部 -5，不等于绝对发生概率。'},
 {id:'explosion',label:'爆炸风险',group:'灾害',families:['production'],version:'1.0',params:[n('value','风险修正',-50,'%',-100,100,10)],path:'IncidentInfectableUpgrade/IncidentExplosionIncreaseUpgrade',encoding:'upgrade',scale:0.1,help:'只对具有爆炸机制的建筑有意义；使用游戏风险修正等级。'},
 {id:'additionalOutput',label:'额外产出',group:'配方',families:['production'],version:'1.0',params:[g('product','额外商品','product'),n('cycles','每几个生产周期',3,'周期',1,10000),n('amount','额外产量',1,'单位',1,10000)],path:'FactoryUpgrade/AdditionalOutput',encoding:'output',repeat:true,help:'额外产出与主产品并存；周期和产量都是正整数。'},
 {id:'replaceInput',label:'原料替换',group:'配方',families:['production'],version:'1.0',params:[g('old','将原料','product'),g('new','替换为','product')],path:'FactoryUpgrade/ReplaceInputs',encoding:'replace',repeat:true,help:'保留原配方数量。工厂必须实际使用被替换原料；不支持有歧义的替换链。'},
 ...V11_EFFECTS,
 ...V12_EFFECTS,
];
export const effectDef=(type:string)=>EFFECTS.find(d=>d.id===type);
export const createEffect=(type:string):Effect=>{const d=effectDef(type);if(!d)throw new Error('未知效果');return{id:uid(),type,enabled:true,params:Object.fromEntries(d.params.map(p=>[p.key,p.default]))};};
export function describeEffect(e:Effect,lookup:(guid:number)=>string=String):string {
 const d=effectDef(e.type);if(!d)return `未知效果：${e.type}`;
 const p=e.params;
 if(d.encoding==='output')return `每 ${p.cycles} 个生产周期额外产出 ${p.amount} 单位${lookup(Number(p.product))}`;
 if(d.encoding==='replace')return `将${lookup(Number(p.old))}替换为${lookup(Number(p.new))}`;
 if(d.encoding==='consumption')return `${lookup(Number(p.need))}消耗量 ${Number(p.value)>0?'+':''}${p.value}%`;
 if(d.encoding==='need')return `满足${lookup(Number(p.provided))}时，同时提供${lookup(Number(p.substitute))}`;
 if(d.params[0]?.kind==='boolean')return `${d.label}：${p.value?'开启':'关闭'}`;
 if(e.type==='workforceType')return `所需劳动力改为${lookup(Number(p.workforce))}`;
 return `${d.label} ${Number(p.value)>0?'+':''}${p.value}${d.params[0]?.unit??''}`;
}
