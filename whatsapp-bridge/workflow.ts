export type Clock={date:string;time:string}
type Workspace={owner_id:string;payload?:{whatsappContacts?:any[];labors?:any[]}}
export function assignedContact(rows:Workspace[],ownerId:string,phone:string){
  const matches=rows.filter(row=>row.owner_id===ownerId).flatMap(row=>(row.payload?.whatsappContacts||[])
    .filter(contact=>contact.enabled&&String(contact.phone).replace(/\D/g,'')===phone)
    .map(contact=>({row,contact})))
  if(matches.length!==1)return null
  const assignment=matches[0]
  return assignment.row.payload?.labors?.some(labor=>Number(labor.id)===Number(assignment.contact.labor_id)&&labor.status==='active')?assignment:null
}

// Catch up only today's scheduled reminders. Never send historical days or
// retry a persisted pending delivery whose actual delivery may be uncertain.
export function dueReminders(rows:Workspace[],ownerId:string,clock:Clock,ledger:Record<string,'pending'|'sent'>){
  return rows.filter(row=>row.owner_id===ownerId).flatMap(row=>(row.payload?.whatsappContacts||[]).flatMap(contact=>{
    const phone=String(contact.phone).replace(/\D/g,''),time=String(contact.send_time||'')
    if(!contact.enabled||contact.id===undefined||!/^\d{9,15}$/.test(phone)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||time>clock.time)return []
    const assignment=assignedContact(rows,ownerId,phone)
    if(!assignment||assignment.contact!==contact)return []
    const labor=row.payload?.labors?.find(labor=>Number(labor.id)===Number(contact.labor_id))
    const key=`${row.owner_id}:${contact.id}:${clock.date}`
    return ledger[key]?[]:[{row,contact,labor,phone,key}]
  }))
}
