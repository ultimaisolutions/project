import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, FunnelChart, LineChart, PieChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([BarChart,FunnelChart,LineChart,PieChart,AriaComponent,GridComponent,LegendComponent,TooltipComponent,CanvasRenderer]);

type Datum={name:string;value:number;actualSpend?:number};
type ValueType = 'currency' | 'number' | 'percent';
export default function Chart({kind,data,label,valueType='number'}:{kind:'line'|'bar'|'pie'|'funnel';data:Datum[];label:string;valueType?:ValueType}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!ref.current)return;const chart=echarts.init(ref.current);const names=data.map(d=>d.name),values=data.map(d=>d.value);const valueFormatter=(value:number)=>valueType==='currency'?new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(value):valueType==='percent'?new Intl.NumberFormat('he-IL',{style:'percent',maximumFractionDigits:1}).format(value):new Intl.NumberFormat('he-IL',{maximumFractionDigits:0}).format(value);const common={aria:{enabled:true,decal:{show:true},description:{enabled:true,prefix:`תרשים ${label}.`}},backgroundColor:'transparent',textStyle:{fontFamily:'Heebo',color:'#A9B9C9'},color:['#22D3EE','#2DD4BF','#60A5FA','#A78BFA','#FBBF24','#FB7185','#64748B'],tooltip:{trigger:'item',valueFormatter},animationDuration:450};
    const option=kind==='pie'?{...common,legend:{bottom:0,textStyle:{color:'#A9B9C9'}},series:[{type:'pie',radius:['45%','70%'],data}]}:kind==='funnel'?{...common,series:[{type:'funnel',left:'12%',width:'76%',label:{color:'#F4F8FC'},data}]}:{...common,legend:kind==='line'?{data:['הכנסות','הוצאה בפועל'],textStyle:{color:'#A9B9C9'}}:undefined,grid:{left:16,right:12,top:kind==='line'?42:16,bottom:36,containLabel:true},xAxis:kind==='bar'?{type:'value',axisLabel:{color:'#71869B',formatter:valueFormatter}}:{type:'category',data:names,axisLabel:{color:'#71869B'}},yAxis:kind==='bar'?{type:'category',data:names,axisLabel:{color:'#A9B9C9'}}:{type:'value',axisLabel:{color:'#71869B',formatter:valueFormatter}},series:kind==='line'?[{name:'הכנסות',type:'line',data:values,smooth:true,areaStyle:{opacity:.08}},{name:'הוצאה בפועל',type:'line',data:data.map(d=>d.actualSpend??0),smooth:true}]:[{type:'bar',data:values,itemStyle:{borderRadius:[0,6,6,0]}}]};chart.setOption(option);const resize=new ResizeObserver(()=>chart.resize());resize.observe(ref.current);return()=>{resize.disconnect();chart.dispose()};},[data,kind,label,valueType]);
  return <div ref={ref} className="chart-canvas" role="img" aria-label={label}/>;
}
