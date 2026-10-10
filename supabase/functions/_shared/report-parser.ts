export type FieldExpense={name:string;amount:number;category:string}
export type FieldParse={status:'worked'|'no_work'|'waste_only';sacks:number|null;expenses:FieldExpense[];confidence:number}

const clean=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const category=(line:string)=>/gasolina|petroleo|combustible|diesel/.test(line)?'Gasolina':/comida|almuerzo|cena|desayuno|aliment/.test(line)?'Alimentación':/trabajador|jornal|pago|maestro|peon/.test(line)?'Trabajadores':/herramienta|broca|pico|pala|martillo/.test(line)?'Herramientas':/material|madera|dinamita|explosivo|cable/.test(line)?'Materiales':'Otros'

export function parseReport(text:string):FieldParse{
  const value=clean(text).replace(/s\/\.?/g,'soles ')
  const noWork=/no\s+(se\s+)?trabaj|hoy\s+no\s+trabaj|descanso|no\s+hubo\s+labor/.test(value)
  const waste=/solo\s+(sacamos|botamos|retiramos|salio|hubo)?\s*desmonte|puro\s+desmonte|desmonte\s+solamente/.test(value)
  const sacksMatch=value.match(/(?:sacamos|salieron|produccion|hicimos|hoy)?\s*(\d+(?:[.,]\d+)?)\s*sacos?\b/)
  const sacks=sacksMatch?Number(sacksMatch[1].replace(',','.')):null
  let ambiguous=(value.match(/\d+(?:[.,]\d+)?\s*sacos?\b/g)||[]).length>1||((noWork||waste)&&Boolean(sacks))||/-\s*\d/.test(value)
  const expenses:FieldExpense[]=[]
  for(const line of value.split(/[\n;]+/)){
    if(!/gast|pago|compro|costo|soles|gasolina|petroleo|aliment|herramient|material|jornal/.test(line))continue
    // Una cifra de sacos nunca se interpreta también como dinero.
    const expenseLine=line.replace(/\d+(?:[.,]\d+)?\s*sacos?\b/g,'')
    const amounts=expenseLine.match(/(?:soles\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:soles)?\b/g)?.map(entry=>Number(entry.replace(/[^\d,.]/g,'').replace(',','.'))).filter(Number.isFinite)
    if(amounts&&amounts.length>1)ambiguous=true
    if(amounts?.length!==1)continue // Varios montos requieren separar conceptos o revisión.
    const amount=amounts?.at(-1)||0;if(amount<=0)continue
    const name=line.replace(/\b\d+(?:[.,]\d+)?\b/g,'').replace(/\b(soles|gaste|gastamos|gasto|pague|pagamos|compre|costo|en)\b/g,' ').replace(/\s+/g,' ').trim()
    expenses.push({name:name?name[0].toUpperCase()+name.slice(1):'Gasto informado por WhatsApp',amount,category:category(line)})
  }
  const status:FieldParse['status']=noWork?'no_work':waste&&!sacks?'waste_only':'worked'
  const signals=(status!=='worked'?1:0)+(sacks!==null?1:0)+(expenses.length?1:0)
  return {status,sacks:status==='worked'?sacks:null,expenses,confidence:ambiguous?.25:Math.min(.98,.45+signals*.2)}
}
