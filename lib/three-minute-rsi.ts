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
  if(times.some((time,i)=>i>0&&time-times[i-1]!==STEP))return null;
  const last=times.at(-1)!;
  const prices=times.map(time=>byTime.get(time)!);
  let avgGain=0,avgLoss=0;
  for(let i=1;i<=period;i++){
    const d=prices[i]-prices[i-1];
    avgGain+=Math.max(d,0);avgLoss+=Math.max(-d,0);
  }
  avgGain/=period;avgLoss/=period;
  for(let i=period+1;i<prices.length;i++){
    const d=prices[i]-prices[i-1];
    avgGain=(avgGain*(period-1)+Math.max(d,0))/period;
    avgLoss=(avgLoss*(period-1)+Math.max(-d,0))/period;
  }
  const value=avgLoss===0?(avgGain===0?50:100):100-100/(1+avgGain/avgLoss);
  return {value,at:last,alert:value>70?"OVERBOUGHT" as const:value<30?"OVERSOLD" as const:null};
}
