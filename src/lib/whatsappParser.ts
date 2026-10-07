export type ParsedExpense={name:string;amount:number;category:string}
export type ParsedFieldReport={status:'worked'|'no_work'|'waste_only';sacks:number|null;expenses:ParsedExpense[];confidence:number;notes:string[]}

const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const categoryFor=(line:string)=>{
  if(/gasolina|petroleo|combustible|diesel/.test(line))return 'Gasolina'
  if(/comida|almuerzo|cena|desayuno|aliment/.test(line))return 'Alimentación'
  if(/trabajador|jornal|pago|maestro|peon/.test(line))return 'Trabajadores'
  if(/herramienta|broca|pico|pala|martillo/.test(line))return 'Herramientas'
  if(/material|madera|dinamita|explosivo|cable/.test(line))return 'Materiales'
  return 'Otros'
}

export function parseFieldReport(text:string):ParsedFieldReport{
  const plain=normalize(text).replace(/s\/\.?/g,'soles ')
  const noWork=/no\s+(se\s+)?trabaj|hoy\s+no\s+trabaj|descanso|no\s+hubo\s+labor/.test(plain)
  const waste=/solo\s+(sacamos|salio|hubo)?\s*desmonte|puro\s+desmonte|desmonte\s+solamente/.test(plain)
  const sacksMatch=plain.match(/(?:sacamos|salieron|produccion|hicimos|hoy)?\s*(\d+(?:[.,]\d+)?)\s*sacos?\b/)
  const sacks=sacksMatch?Number(sacksMatch[1].replace(',','.')):null
  const expenses:ParsedExpense[]=[]
  for(const source of plain.split(/[\n;]+/)){
    if(!/gast|pago|compro|costo|soles|gasolina|petroleo|aliment|herramient|material|jornal/.test(source))continue
    const amountMatch=source.match(/(?:soles\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:soles)?\b/g)?.map(value=>Number(value.replace(/[^\d,.]/g,'').replace(',','.'))).filter(Number.isFinite)
    const amount=amountMatch?.at(-1)||0;if(amount<=0)continue
    const cleaned=source.replace(/\b\d+(?:[.,]\d+)?\b/g,'').replace(/\b(soles|gaste|gastamos|gasto|pague|pagamos|compre|costo|en)\b/g,' ').replace(/\s+/g,' ').trim()
    expenses.push({name:cleaned?cleaned[0].toUpperCase()+cleaned.slice(1):'Gasto informado por WhatsApp',amount,category:categoryFor(source)})
  }
  const status:ParsedFieldReport['status']=noWork?'no_work':waste&&!sacks?'waste_only':'worked'
  const signals=(status!=='worked'?1:0)+(sacks!==null?1:0)+(expenses.length?1:0)
  return {status,sacks:status==='worked'?sacks:null,expenses,confidence:Math.min(.98,.45+signals*.2),notes:[...(sacks===null&&status==='worked'?['No se detectó una cantidad de sacos.']:[]),...(!expenses.length?['No se detectaron gastos.']:[])]}
}

export function dailyPrompt(laborName:string){return `Hola, reporte diario de ${laborName}. Responde por favor: 1) ¿Cuántos sacos sacaron hoy? 2) ¿Qué gastos tuvieron y cuánto? Si no trabajaron o solo sacaron desmonte, indícalo. Puedes responder por texto o audio.`}
