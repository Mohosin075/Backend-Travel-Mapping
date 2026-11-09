const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const path=require('node:path');
function load(file,imports={}) {
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{module,exports:module.exports,require:n=>imports[n]||{},console});
 return module.exports;
}
function fixture(price=35) {
 const calls={payments:[],checkouts:[],intents:[]};
 const {localizeField}=load('src/helpers/localize.ts');
 const mocks={
  '../user/user.model':{User:{findById:async()=>({purchasedMaps:[]})}},
  '../map/map.model':{Map:{findById:async()=>({isPaid:true,price,name:{es:'Puerto Rico',en:'Puerto Rico'},description:{es:'Mapa de viaje',en:'Travel map'}})}},
  './payment.model':{Payment:{create:async p=>calls.payments.push(p)}},
  '../../helpers/localize':{localizeField},
  '../../config':{clientUrl:'https://example.test'},
  './webhook.service':{WebhookService:{}},
  '../../errors/ApiError':class extends Error{},
  'http-status-codes':{StatusCodes:{}},
  '../../config/stripe':{checkout:{sessions:{create:async p=>{calls.checkouts.push(p);return {id:'cs_mock',url:'https://checkout.example.test'}}}},paymentIntents:{create:async p=>{calls.intents.push(p);return {id:'pi_mock',client_secret:'secret_mock'}}}},
 };
 return {service:load('src/modules/payment/payment.service.ts',mocks).PaymentServices,calls};
}
const user={authId:'user1',email:'buyer@example.test'};
for(const flow of ['createCheckoutSession','createPaymentIntent']) {
 for(const currency of [undefined,'usd','USD','EUR','eur','gbp']) {
  test(`${flow}: USD amount and stored currency remain consistent for client currency ${currency}`,async()=>{
   const {service,calls}=fixture();
   await service[flow](user,{mapId:'map1',amount:1,...(currency===undefined?{}:{currency})});
   const request=flow==='createCheckoutSession'?calls.checkouts[0].line_items[0].price_data:calls.intents[0];
   assert.equal(request.currency,'usd');
   assert.equal(request.unit_amount??request.amount,3500);
   assert.equal(calls.payments[0].currency,'USD');
   assert.equal(calls.payments[0].amount,35);
   assert.equal(calls.payments[0].userId,'user1');
   if(flow==='createCheckoutSession'){
    assert.equal(request.product_data.name,'Puerto Rico');
    assert.equal(request.product_data.description,'Mapa de viaje');
   }
  });
 }
 test(`${flow}: decimal USD prices are converted to cents`,async()=>{
  const {service,calls}=fixture(35.99);
  await service[flow](user,{mapId:'map1'});
  const request=flow==='createCheckoutSession'?calls.checkouts[0].line_items[0].price_data:calls.intents[0];
  assert.equal(request.unit_amount??request.amount,3599);
  assert.equal(calls.payments[0].amount,35.99);
 });
}
