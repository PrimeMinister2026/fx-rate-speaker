import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {selectAdoptedRates,RATE_CODES} from '../lib/adopted-rates.ts';
let sequence=0;
async function loadRoute(yahoo){
 let source=await readFile(new URL('../app/api/rates/current/route.ts',import.meta.url),'utf8');
 source=source.replace(/import \{ GET as yahooSnapshot \} from "\.\.\/route";/,'const yahooSnapshot = globalThis.__yahooSnapshot;').replace(/import \{ RATE_CODES, selectAdoptedRates, type RateMap \} from "@\/lib\/adopted-rates";/,'const {RATE_CODES,selectAdoptedRates} = globalThis.__policy;');
 globalThis.__policy={RATE_CODES,selectAdoptedRates};globalThis.__yahooSnapshot=yahoo;
 return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+'\n// '+(++sequence)).toString('base64'));
}
test('shared API uses one batched OANDA midpoint request and coalesces cache/concurrent requests',async()=>{
 const original=globalThis.fetch, oldToken=process.env.OANDA_API_TOKEN,oldAccount=process.env.OANDA_ACCOUNT_ID;
 process.env.OANDA_API_TOKEN='test-only';process.env.OANDA_ACCOUNT_ID='test-account';
 let calls=0,yahooCalls=0;
 const expected=Object.fromEntries(RATE_CODES.map((code,i)=>[code,{price:code.endsWith('/JPY')?158.342+i:1.16184+i/10,timestamp:Math.floor(Date.now()/1000)}]));
 globalThis.fetch=async url=>{calls++;assert.equal(new URL(url).searchParams.get('instruments').split(',').length,10);return Response.json({prices:Object.entries(expected).map(([code,r])=>({instrument:code.replace('/','_'),time:new Date(r.timestamp*1000).toISOString(),bids:[{price:String(r.price-.00001)}],asks:[{price:String(r.price+.00001)}]}))})};
 try{const api=await loadRoute(async()=>{yahooCalls++;return Response.json({rates:{}})});const [a,b]=await Promise.all([api.currentSnapshot(),api.currentSnapshot()]);assert.equal(a,b);assert.equal(calls,1);assert.equal(yahooCalls,0);assert.equal(await api.currentSnapshot(),a);for(const code of ['USD/JPY','EUR/USD','GBP/USD','AUD/USD','EUR/JPY']){assert.ok(Math.abs(a.rates[code].price-expected[code].price)<1e-12);assert.equal(a.sources[code],'OANDA')}assert.equal((await api.GET()).status,200)}finally{globalThis.fetch=original;if(oldToken===undefined)delete process.env.OANDA_API_TOKEN;else process.env.OANDA_API_TOKEN=oldToken;if(oldAccount===undefined)delete process.env.OANDA_ACCOUNT_ID;else process.env.OANDA_ACCOUNT_ID=oldAccount}
});
test('OANDA failure uses existing Yahoo result without timestamp refresh; partial failure is safe',async()=>{
 const original=globalThis.fetch, oldToken=process.env.OANDA_API_TOKEN,oldAccount=process.env.OANDA_ACCOUNT_ID;
 process.env.OANDA_API_TOKEN='test-only';process.env.OANDA_ACCOUNT_ID='test-account';globalThis.fetch=async()=>{throw Error('offline')};
 try{const old={price:1.16184,timestamp:Math.floor(Date.now()/1000)-100};const api=await loadRoute(async()=>Response.json({rates:{'EUR/USD':old}}));const a=await api.currentSnapshot();assert.deepEqual(a.rates['EUR/USD'],old);assert.equal(a.sources['EUR/USD'],'YAHOO');const empty=await loadRoute(async()=>{throw Error('offline')});assert.equal((await empty.GET()).status,502)}finally{globalThis.fetch=original;if(oldToken===undefined)delete process.env.OANDA_API_TOKEN;else process.env.OANDA_API_TOKEN=oldToken;if(oldAccount===undefined)delete process.env.OANDA_ACCOUNT_ID;else process.env.OANDA_ACCOUNT_ID=oldAccount}
});
