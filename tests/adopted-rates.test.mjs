import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {selectAdoptedRates, RATE_CODES} from '../lib/adopted-rates.ts';
const now=Date.now(), ts=Math.floor(now/1000);
const full=Object.fromEntries(RATE_CODES.map((code,i)=>[code,{price:[158.342,1.16184,1.34215,.66789,183.96,212.52,105.75,.86566,1.73956,2.0095][i],timestamp:ts}]));
// Execute the original v118 browser policy against the same snapshots.
const old=execFileSync('git',['show','23fc6365fafb836f2e24592957fd2c61fef7d0e8:app/page.tsx'],{encoding:'utf8'});
const policy=old.slice(old.indexOf('  function freshOandaRate('),old.indexOf('  function updateRateSnapshot('));
function original(oanda,yahoo){const ctx={Date:class extends Date{static now(){return now}},OANDA_PRIMARY_STALE_MS:60000,PAIRS:RATE_CODES.map(code=>({code})),oandaLiveRef:{current:oanda},ratesRef:{},setRates(){},setRateSources(s){ctx.sources=s}};vm.createContext(ctx);vm.runInContext(stripTypeScriptTypes(policy+'\nglobalThis.result=applyAdoptedRates('+JSON.stringify(yahoo)+');'),ctx);return JSON.parse(JSON.stringify({rates:ctx.result,sources:ctx.sources}))}
test('shared policy matches v118 browser final rates for direct, cross, stale and Yahoo cases',()=>{
 const fixtures=[full,{},Object.fromEntries(Object.entries(full).filter(([k])=>k.endsWith('/JPY'))),Object.fromEntries(Object.entries(full).map(([k,v])=>[k,{...v,timestamp:ts-61}])),Object.fromEntries(Object.entries(full).map(([k,v])=>[k,{...v,timestamp:ts+21}]))];
 for(const oanda of fixtures)assert.deepEqual(selectAdoptedRates(oanda,full,now),original(oanda,full));
 for(const pair of ['USD/JPY','EUR/USD','GBP/USD','AUD/USD','EUR/JPY'])assert.equal(selectAdoptedRates(full,{},now).rates[pair].price,full[pair].price);
});
test('cross timestamp uses older source; direct wins; no correction from audit learning',()=>{
 const oanda={'USD/JPY':{price:150,timestamp:ts},'EUR/JPY':{price:180,timestamp:ts-5}};
 const result=selectAdoptedRates(oanda,{'EUR/USD':{price:9,timestamp:ts}},now);
 assert.equal(result.rates['EUR/USD'].price,1.2);assert.equal(result.rates['EUR/USD'].timestamp,ts-5);assert.equal(result.sources['EUR/USD'],'OANDA_SYNTHETIC');
 oanda['EUR/USD']={price:1.21,timestamp:ts};assert.equal(selectAdoptedRates(oanda,{},now).rates['EUR/USD'].price,1.21);
});
