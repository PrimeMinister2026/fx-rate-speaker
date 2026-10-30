/** Wilder RSI for confirmed, contiguous 3-minute OHLC only. Never use ticks as a substitute. */
export type ThreeMinuteClose = {time:number;close:number};
const STEP=180_000;
export function threeMinuteRsi(candles:readonly ThreeMinuteClose[], now:number, period=14) {
  if (!Number.isSafeInteger(now)||!Number.isInteger(period)||period<2) return null;
  const byTime=new Map<number,number>();
  for(const c of candles){
    if(!c||!Number.isSafeInteger(c.time)||!Number.isFinite(c.close)||c.close<=0)continue;
    if(c.time%STEP!==0||c.time+STEP>now)continue;
    byTime.set(c.time,c.close);
  }
  const times=[...byTime.keys()].sort((a,b)=>a-b);
  if(times.length<period+1)return null;
  const last=times.at(-1)!;
  const closes:number[]=[];
  for(let i=period;i>=0;i--){
    const price=byTime.get(last-i*STEP);
    if(price===undefined)return null;
    closes.push(price);
  }
  let gain=0,loss=0;
  for(let i=1;i<closes.length;i++){
    const change=closes[i]-closes[i-1];
    gain+=Math.max(change,0);loss+=Math.max(-change,0);
  }
  // Seed from first 14 deltas. For exact Wilder continuation, pass sufficient
  // contiguous history and seed from the beginning, not only the final window.
  let avgGain=gain/period,avgLoss=loss/period;
  if(times.length>period+1){
    const all=times.slice();
    if(all.every((time,i)=>i===0||time-all[i-1]===STEP)){
      const prices=all.map(time=>byTime.get(time)!);
      avgGain=0;avgLoss=0;
      for(let i=1;i<=period;i++){const d=prices[i]-prices[i-1];avgGain+=Math.max(d,0);avgLoss+=Math.max(-d,0)}
      avgGain/=period;avgLoss/=period;
      for(let i=period+1;i<prices.length;i++){const d=prices[i]-prices[i-1];avgGain=(avgGain*(period-1)+Math.max(d,0))/period;avgLoss=(avgLoss*(period-1)+Math.max(-d,0))/period}
    }
  }
  const value=avgLoss===0?(avgGain===0?50:100):100-100/(1+avgGain/avgLoss);
  return {value,at:last,alert:value>70?"OVERBOUGHT" as const:value<30?"OVERSOLD" as const:null};
}
