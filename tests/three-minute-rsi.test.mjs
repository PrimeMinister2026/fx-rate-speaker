import test from "node:test";
import assert from "node:assert/strict";
const {threeMinuteRsi}=await import("../lib/three-minute-rsi.ts");
const step=180000,start=Date.UTC(2026,9,30,0,0);
const candles=(closes)=>closes.map((close,i)=>({time:start+i*step,close}));
const time=(n)=>start+n*step;
test("overbought on consecutive confirmed gains",()=>{
 const r=threeMinuteRsi(candles(Array.from({length:20},(_,i)=>100+i)),time(20));
 assert.equal(r?.alert,"OVERBOUGHT");assert.equal(r?.value,100);
});
test("oversold on consecutive confirmed losses",()=>{
 const r=threeMinuteRsi(candles(Array.from({length:20},(_,i)=>100-i)),time(20));
 assert.equal(r?.alert,"OVERSOLD");assert.equal(r?.value,0);
});
test("no alert for equal close and no forming candle",()=>{
 const c=candles(Array.from({length:16},()=>100));
 c.push({time:time(16),close:150});
 const r=threeMinuteRsi(c,time(16));
 assert.equal(r?.value,50);assert.equal(r?.at,time(15));assert.equal(r?.alert,null);
});
test("missing or noncontiguous input does not fabricate RSI",()=>{
 assert.equal(threeMinuteRsi(candles([101,102]),time(2)),null);
 const c=candles(Array.from({length:22},(_,i)=>100+i));
 c.splice(5,1);assert.equal(threeMinuteRsi(c,time(22)),null);
});
