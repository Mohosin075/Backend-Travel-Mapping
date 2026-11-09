const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mongoose = require('mongoose');
function load(file, imports) {
  const module = {exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {module,exports:module.exports,require:n=>imports[n]||{},console,Date,setTimeout,clearTimeout});
  return module.exports;
}
const id = n => n.toString(16).padStart(24,'0');
function matches(u,q) {
  return Object.entries(q).every(([key,v])=>{
    if(key==='$or') return v.some(part=>matches(u,part));
    const a=key.split('.').reduce((obj,p)=>obj?.[p],u);
    if(v && typeof v.test==='function') return v.test(a||'');
    if(v && '$ne' in Object(v)) return a!==v.$ne;
    if(v && '$in' in Object(v)) return v.$in.some(x=>String(x)===String(a));
    if(v && '$gte' in Object(v)) return a>=v.$gte && (!v.$lte || a<=v.$lte);
    return a===v;
  });
}
function chain(rows) {
 let offset=0,limit=Infinity;
 const q={select:()=>q,populate:()=>q,sort:()=>q,skip:n=>{offset=n;return q},limit:n=>{limit=n;return q},lean:()=>Promise.resolve(rows.slice(offset,offset+limit))};
 return q;
}
const live = Array.from({length:151},(_,n)=>({_id:id(n+1),name:`Person ${n+1}`,email:`u${n+1}@example.test`,status:'active',createdAt:new Date(),address:{country:'Puerto Rico'}}));
const deleted={_id:id(999),name:'Deleted',status:'deleted'};
function service(overrides = {}) {
 const users=[...live,deleted];
 const current=new Date(),old=new Date(current); old.setFullYear(old.getFullYear()-1);
 const empty={find:()=>chain([]),aggregate:async()=>[],distinct:async()=>[],countDocuments:async()=>0};
 const userModel={collection:{name:'users'},find:q=>chain(users.filter(u=>matches(u,q))),countDocuments:async q=>users.filter(u=>matches(u,q)).length,distinct:async()=>[]};
 const imports={mongoose,'../../helpers/localize':{localizeField:v=>typeof v==='object'?v?.es||v?.en:v},'../../errors/ApiError':class extends Error {},'http-status-codes':{StatusCodes:{}},'../user/user.model':{User:userModel},'../payment/payment.model':{Payment:{find:()=>chain([{amount:10,createdAt:current},{amount:90,createdAt:old}])}},
 './recent-place-views':{recentPlaceViews:async()=>[]},
 './usage-reporting':{rankedViewers:async()=>[],distinctViewers:async()=>[...live.map(u=>`user:${u._id}`),`user:${deleted._id}`,`user:${id(888)}`,'guest:one','guest:two']}};
 for(const [module,name] of [['map','Map'],['place','Place'],['offer','Offer'],['business','Business'],['visited','Visited'],['review','Review']]) imports[`../${module}/${module}.model`]={[name]:empty};
 imports['../offer/offerRedemption.model']={OfferRedemption:{...empty,find:()=>chain([{_id:id(21),user:live[0],redemptionTime:current},{_id:id(22),user:live[0],redemptionTime:old},{_id:id(23),user:null}])}};
 imports['./usage-reporting'].entityViewers=async()=>[{viewerKey:`user:${live[0]._id}`},{viewerKey:`user:${deleted._id}`},{viewerKey:`user:${id(888)}`},{viewerKey:'guest:one'}];
 Object.assign(imports, overrides);
 return load('src/modules/stats/stats.service.ts',imports).StatsService;
}

test('all three usage rankings order by profiles descending before applying the top-20 limit', async () => {
 const rows = Array.from({length:25}, (_,n)=>({_id:id(200+n),name:`Entity ${n}`,title:`Offer ${n}`,count:100-n,profileCount:n+1}));
 const model = {find:()=>chain(rows),aggregate:async()=>[],distinct:async()=>[],countDocuments:async()=>25};
 const overrides = {
  '../map/map.model':{Map:model}, '../place/place.model':{Place:model}, '../offer/offer.model':{Offer:model},
  '../offer/offerRedemption.model':{OfferRedemption:{...model,aggregate:async()=>rows}},
  './usage-reporting':{rankedViewers:async()=>rows,distinctViewers:async()=>[]},
 };
 const {usage} = await service(overrides).getReportsData();
 for(const key of ['mostViewedMaps','mostOpenedPlaces','mostRedeemedOffers']) {
  assert.deepEqual(Array.from(usage[key], row=>row.profileCount), Array.from({length:20},(_,n)=>25-n), key);
  assert.equal(usage[key][0].id,id(224));
 }
});
test('all registered profiles beyond 100 can be reached with accurate totals and no duplicates',async()=>{
 const svc=service(),seen=[];
 for(let page=1;page<=7;page++) {const result=await svc.getRegisteredUsers({page});assert.equal(result.total,151);assert.equal(result.totalPages,7);seen.push(...result.users.map(u=>String(u._id)));}
 assert.equal(seen.length,151);assert.equal(new Set(seen).size,151);assert.ok(!seen.includes(deleted._id));
});
test('registered search finds a profile beyond the old cap and uses literal country/search text',async()=>{
 const svc=service();
 assert.equal((await svc.getRegisteredUsers({search:'Person 151'})).users[0].name,'Person 151');
 assert.equal((await svc.getRegisteredUsers({search:'.*'})).total,0);
 assert.equal((await svc.getRegisteredUsers({country:'Puerto Rico'})).total,151);
 assert.equal((await svc.getRegisteredUsers({country:'.*'})).total,0);
 assert.equal((await svc.getRegisteredUsers({page:-1})).page,1);
});
test('active counters equal available profile lists; guests and deleted/missing accounts do not inflate them',async()=>{
 const {userActivity:a}=await service().getReportsData();
 for(const [count,list] of [['activeUsersToday','activeTodayList'],['activeUsersThisWeek','activeWeekList'],['activeUsersThisMonth','activeMonthList']]) {assert.equal(a[count],151);assert.equal(a[count],a[list].length);}
 assert.equal(a.totalRegisteredUsers,151);assert.equal(a.guestVisitorsToday,2);
});
test('same month from a prior year does not inflate the current sales chart',async()=>{
 const r=await service().getReportsData();
 assert.equal(r.salesAndTaxes.totalSales,100);
 assert.equal(r.salesAndTaxes.monthlyData.reduce((n,m)=>n+m.totalSales,0),10);
});
test('viewer drilldown reconciles profiles, guests, and missing/deleted accounts',async()=>{
 const r=await service().getEntityUsers('map',id(100));
 assert.equal(r.profileCount,1);assert.equal(r.guestCount,1);assert.equal(r.unavailableCount,2);
 assert.equal(r.totalCount,r.profileCount+r.guestCount+r.unavailableCount);
});
test('repeat and unavailable redemptions remain events, with one row per available profile',async()=>{
 const r=await service().getEntityUsers('offer',id(100));
 assert.equal(r.totalCount,3);assert.equal(r.profileCount,1);assert.equal(r.users.length,1);assert.equal(r.users[0].redemptionCount,2);assert.equal(r.unavailableRedemptions,1);
});

test('All Users UI can move past 100 profiles without reusing a previous page response',()=>{
 let slots=[],cursor=0,query;
 const jsx=(type,props)=>({type,props:props||{}});
 const hooks={useState(initial){const i=cursor++;if(!(i in slots)) slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]},useEffect(){}};
 const front='../frontend_giovafilm_roadtripeado/components/dashboard/reports/user-activity.tsx';
 const api={useGetRegisteredReportUsersQuery(args,options){query={args,options};const users=live.slice((args.page-1)*25,args.page*25);return {currentData:options.skip?undefined:{data:{users,total:151,totalPages:7}},isFetching:false,isError:false,refetch(){}}}};
 const component=load(front,{'react':hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'@/redux/features/stats/statsApi':api,'@/lib/i18n/LanguageContext':{useLanguage:()=>({language:'en',t:()=>''})},'@/lib/utils':{getProfileImageUrl:()=>''},'next/navigation':{useRouter:()=>({push(){}})}}).UserActivityOverview;
 function nodes(node){if(!node||typeof node!=='object') return [];if(Array.isArray(node))return node.flatMap(nodes);return [node,...nodes(node.props?.children)];}
 function text(node){if(Array.isArray(node))return node.map(text).join(' ');if(node&&typeof node==='object')return text(node.props?.children);return node==null?'':String(node);}
 function render(){cursor=0;return component({data:{totalRegisteredUsers:151},country:'Puerto Rico'})}
 let tree=render();nodes(tree).find(n=>n.type==='button'&&text(n).includes('View Active Users & Profiles')).props.onClick();
 tree=render();nodes(tree).find(n=>n.type==='button'&&text(n).includes('All Users')).props.onClick();
 for(let page=1;page<=7;page++){
  tree=render();assert.equal(query.options.skip,false);assert.equal(query.args.page,page);assert.equal(query.args.country,'Puerto Rico');
  const profiles=nodes(tree).filter(n=>n.type==='button'&&text(n).trim()==='View Profile');
  assert.equal(profiles.length,page===7?1:25);
  if(page<7) nodes(tree).find(n=>n.type==='button'&&text(n)==='Next').props.onClick();
 }
 assert.equal(nodes(tree).find(n=>n.type==='button'&&text(n)==='Next').props.disabled,true);
});

test('map statistics expose the identifiable profile count as the clickable count',()=>{
 const jsx=(type,props)=>({type,props:props||{}});
 const imports={'react':{useState:initial=>[initial,()=>{}]},'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/i18n/LanguageContext':{useLanguage:()=>({language:'en',t:()=>''})},'@/lib/utils':{getLocalized:v=>v},'next/navigation':{useRouter:()=>({push(){}})}};
 const {UsageStatistics}=load('../frontend_giovafilm_roadtripeado/components/dashboard/reports/usage-statistics.tsx',imports);
 const tree=UsageStatistics({data:{mostViewedMaps:[{id:id(1),name:'Puerto Rico',count:5,profileCount:2}],mostOpenedPlaces:[],mostRedeemedOffers:[]}});
 function nodes(n){if(!n||typeof n!=='object')return [];if(Array.isArray(n))return n.flatMap(nodes);return [n,...nodes(n.props?.children)];}
 function text(n){if(Array.isArray(n))return n.map(text).join(' ');if(n&&typeof n==='object')return text(n.props?.children);return n==null?'':String(n);}
 const column=nodes(tree).find(n=>typeof n.type==='function'&&n.props.type==='map');
 const rendered=column.type(column.props);
 assert.ok(nodes(rendered).some(n=>n.type==='button'&&text(n).replace(/\s+/g,' ').trim()==='2 profiles'));
 assert.ok(nodes(rendered).some(n=>n.type==='span'&&text(n).replace(/\s+/g,' ').trim()==='5 visitors'));
});

test('report exports preserve quotes/newlines in CSV cells and render stored names as HTML text',()=>{
 const {csvCell,htmlText}=load('../frontend_giovafilm_roadtripeado/lib/report-export.ts',{});
 const name='Beach, "North"\n<script>alert(1)</script>';
 const encoded=csvCell(name);
 assert.equal(encoded[0],'"');assert.equal(encoded.at(-1),'"');
 assert.equal(encoded.slice(1,-1).replace(/""/g,'"'),name);
 const html=`<td>${htmlText(name)}</td>`;
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
});
