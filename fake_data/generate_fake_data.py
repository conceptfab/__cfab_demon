from __future__ import annotations
import json, math, random, re
from pathlib import Path
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta

R=random.Random(20260222)
OUT=Path(__file__).resolve().parent
END=date(2026,2,22)

APPS={
 'photoshop.exe':('Adobe Photoshop','psd'),
 'illustrator.exe':('Adobe Illustrator','ai'),
 'indesign.exe':('Adobe InDesign','indd'),
 'afterfx.exe':('Adobe After Effects','aep'),
 'premierepro.exe':('Adobe Premiere Pro','prproj'),
 'acrobat.exe':('Adobe Acrobat','pdf'),
 'bridge.exe':('Adobe Bridge','bridge'),
 'figma.exe':('Figma','fig'),
 'blender.exe':('Blender','blend'),
 'code.exe':('Visual Studio Code','html'),
}

K={
 'publication':({'indesign.exe':.43,'illustrator.exe':.18,'photoshop.exe':.15,'acrobat.exe':.14,'bridge.exe':.10},['indesign.exe','photoshop.exe']),
 'lookbook':({'indesign.exe':.34,'photoshop.exe':.28,'illustrator.exe':.14,'acrobat.exe':.12,'bridge.exe':.12},['indesign.exe','photoshop.exe']),
 'brand_guidelines':({'indesign.exe':.38,'illustrator.exe':.26,'photoshop.exe':.12,'figma.exe':.10,'acrobat.exe':.14},['indesign.exe','illustrator.exe']),
 'packaging':({'illustrator.exe':.34,'photoshop.exe':.22,'blender.exe':.18,'acrobat.exe':.10,'indesign.exe':.08,'bridge.exe':.08},['illustrator.exe','photoshop.exe','blender.exe']),
 'packaging_3d':({'illustrator.exe':.28,'photoshop.exe':.18,'blender.exe':.28,'acrobat.exe':.10,'indesign.exe':.06,'bridge.exe':.10},['blender.exe','illustrator.exe','photoshop.exe']),
 'visualization':({'photoshop.exe':.28,'illustrator.exe':.20,'blender.exe':.22,'figma.exe':.10,'acrobat.exe':.08,'afterfx.exe':.12},['photoshop.exe','blender.exe','illustrator.exe']),
 'digital_campaign':({'photoshop.exe':.34,'illustrator.exe':.20,'figma.exe':.16,'afterfx.exe':.12,'acrobat.exe':.08,'bridge.exe':.10},['photoshop.exe','illustrator.exe','figma.exe']),
 'signage':({'illustrator.exe':.34,'indesign.exe':.24,'photoshop.exe':.14,'figma.exe':.10,'acrobat.exe':.12,'bridge.exe':.06},['illustrator.exe','indesign.exe']),
 'infographic':({'illustrator.exe':.38,'photoshop.exe':.16,'indesign.exe':.18,'figma.exe':.10,'acrobat.exe':.10,'bridge.exe':.08},['illustrator.exe','indesign.exe']),
 'presentation_design':({'illustrator.exe':.26,'photoshop.exe':.20,'indesign.exe':.22,'figma.exe':.12,'acrobat.exe':.12,'code.exe':.08},['illustrator.exe','indesign.exe','photoshop.exe']),
 'motion':({'afterfx.exe':.44,'premierepro.exe':.20,'photoshop.exe':.14,'illustrator.exe':.10,'acrobat.exe':.06,'figma.exe':.06},['afterfx.exe','premierepro.exe']),
 'ui_campaign':({'figma.exe':.42,'photoshop.exe':.14,'illustrator.exe':.12,'code.exe':.18,'acrobat.exe':.06,'afterfx.exe':.08},['figma.exe','code.exe','photoshop.exe']),
 'ui_dashboard':({'figma.exe':.54,'illustrator.exe':.10,'photoshop.exe':.08,'code.exe':.20,'acrobat.exe':.04,'afterfx.exe':.04},['figma.exe','code.exe']),
 'annual_report':({'indesign.exe':.48,'illustrator.exe':.20,'photoshop.exe':.14,'acrobat.exe':.10,'figma.exe':.04,'code.exe':.04},['indesign.exe','illustrator.exe']),
}

STEMS={
 'photoshop.exe':['master','retouch','exports'], 'illustrator.exe':['vector','icons','dieline'], 'indesign.exe':['layout','spreads','print'],
 'afterfx.exe':['main_comp','variants','loop'], 'premierepro.exe':['timing_edit','render_queue'], 'acrobat.exe':['proof','comments'],
 'bridge.exe':['asset_selects','reference_board'], 'figma.exe':['ui_master','review_board','handoff'], 'blender.exe':['scene','lighting','camera'],
 'code.exe':['prototype','styles','hooks']
}
CODE_EXTS=['html','css','js']
STOP={'the','and','for','with','set','series','batch','line','update','system','layout','visuals','campaign','design','assets','2025','2026'}
HR={'heavy':(60,120,4.6),'medium':(18,50,3.0),'light':(6,16,1.9)}

P=[
 ('Northwind Beverages','Summer Catalog 2025','publication','heavy','2025-06-03','2025-07-18'),
 ('Northwind Beverages','Sparkling Line Packaging Refresh','packaging','heavy','2025-06-10','2025-08-08'),
 ('Northwind Beverages','Trade Show Booth Visuals','visualization','medium','2025-07-15','2025-09-05'),
 ('Northwind Beverages','Holiday POS Display Set','digital_campaign','medium','2025-09-18','2025-11-14'),
 ('Harbor & Pine Hotels','Brand Guidelines Update','brand_guidelines','medium','2025-06-17','2025-07-31'),
 ('Harbor & Pine Hotels','Winter Campaign Key Visuals','digital_campaign','medium','2025-09-09','2025-11-07'),
 ('Harbor & Pine Hotels','Room Service Menu Layout Series','publication','light','2025-10-02','2025-12-03'),
 ('Luma Dental Group','Clinic Wayfinding Signage System','signage','medium','2025-06-24','2025-08-15'),
 ('Luma Dental Group','Pediatric Brochure Illustration Pack','publication','light','2025-08-05','2025-09-12'),
 ('Atlas BioLabs','Investor Deck Visual System','presentation_design','medium','2025-07-01','2025-08-29'),
 ('Atlas BioLabs','Lab Equipment 3D Render Set','visualization','heavy','2025-08-18','2025-10-24'),
 ('Atlas BioLabs','Conference Poster Series 2025','publication','medium','2025-09-22','2025-11-06'),
 ('Cedar Peak Outdoor','Product Launch Lookbook','lookbook','heavy','2025-07-08','2025-09-19'),
 ('Cedar Peak Outdoor','E-commerce Banner Batch Q3','digital_campaign','medium','2025-07-22','2025-09-05'),
 ('Cedar Peak Outdoor','Trail Map Infographic System','infographic','medium','2025-08-12','2025-10-10'),
 ('Aurora Retail Co.','Autumn Window Display Concepts','visualization','medium','2025-08-25','2025-10-03'),
 ('Aurora Retail Co.','Store Shelf Talker Templates','publication','medium','2025-09-15','2025-11-21'),
 ('Aurora Retail Co.','Private Label Packaging Mockups','packaging_3d','heavy','2025-10-06','2025-12-12'),
 ('Aurora Retail Co.','Black Friday Campaign Assets','digital_campaign','heavy','2025-10-20','2025-11-28'),
 ('Meridian Properties','Tower A Leasing Brochure','publication','medium','2025-09-01','2025-10-31'),
 ('Meridian Properties','Lobby Digital Signage Loop','motion','medium','2025-10-14','2025-12-05'),
 ('Meridian Properties','Rooftop Amenity 3D Visualization','visualization','heavy','2025-11-03','2026-01-16'),
 ('Bluehaven Foods','Frozen Meals Packaging Line','packaging','heavy','2025-11-10','2026-01-30'),
 ('Bluehaven Foods','Recipe Booklet Spring Edition','publication','medium','2025-12-02','2026-02-06'),
 ('Bluehaven Foods','Social Ad Variants January Push','digital_campaign','light','2026-01-05','2026-02-13'),
 ('Solstice Education','Enrollment Campaign Landing Visuals','ui_campaign','medium','2025-12-15','2026-02-20'),
 ('Solstice Education','Annual Report 2025 Layout','annual_report','heavy','2025-12-22','2026-02-18'),
 ('VectorFleet Logistics','Fleet Dashboard UI Mockup','ui_dashboard','medium','2026-01-12','2026-02-22'),
]


def d(s): return date.fromisoformat(s)

def days(a,b):
    x=a
    while x<=b:
        yield x; x+=timedelta(days=1)

def fmt(dt):
    off='+02:00' if date(2025,3,30)<=dt.date()<=date(2025,10,25) else '+01:00'
    return dt.strftime('%Y-%m-%dT%H:%M:%S')+off

def slug(s,n=3):
    t=[x.lower() for x in re.findall(r'[A-Za-z0-9]+',s) if x.lower() not in STOP]
    return (t or ['project'])[:n]

def wsample(items,weights,k):
    z=[]
    for it,w in zip(items,weights):
        u=max(1e-12,min(1-1e-12,R.random())); z.append((u**(1/max(w,1e-6)),it))
    z.sort(reverse=True)
    return sorted([it for _,it in z[:k]])

def alloc(total, weights, g=5):
    if total<=0: return [0]*len(weights)
    total=round(total/g)*g
    s=sum(max(0,w) for w in weights) or len(weights)
    raw=[max(0,w)/s*total for w in weights]
    base=[int(x//g)*g for x in raw]
    rem=total-sum(base)
    fr=sorted(((raw[i]-base[i],i) for i in range(len(weights))), reverse=True)
    i=0
    while rem>0 and fr:
        base[fr[i%len(fr)][1]]+=g; rem-=g; i+=1
    return base

def overlap(s,e):
    t=0; cur=s.date()
    while cur<=e.date():
        a=datetime.combine(cur,time(8)); b=datetime.combine(cur,time(18))
        x=max(s,a); y=min(e,b)
        if y>x: t+=int((y-x).total_seconds())
        cur+=timedelta(days=1)
    return t

def ldt(day,m):
    h,mi=divmod(m,60)
    return datetime.combine(day,time(h%24,mi))+timedelta(days=h//24)

def pick_file(prj,app):
    cslug=slug(prj['client'],1); tslug=slug(prj['title'],2)
    pref='_'.join(cslug+tslug)
    stem=R.choice(STEMS[app])
    ext=APPS[app][1]
    if app=='code.exe' and stem in ('styles','hooks'): ext='css' if stem=='styles' else 'js'
    if app=='code.exe' and stem=='prototype': ext='html'
    return f"{pref}_{stem}.{ext} - {prj['name']}"

projs=[]
for c,t,knd,inty,s,e in P:
    projs.append({'client':c,'title':t,'kind':knd,'intensity':inty,'start':d(s),'end':d(e),'name':f'{c}: {t}'})
projs.sort(key=lambda p:p['start'])

raw=defaultdict(list)
day_load=Counter()
for p in projs:
    lo,hi,avg=HR[p['intensity']]
    h=R.uniform(lo,hi)
    span=(p['end']-p['start']).days+1
    h*=min(1.15,max(.85,span/55))
    if p['kind'] in {'annual_report','packaging_3d','ui_dashboard'}: h*=1.08
    if p['kind']=='publication' and p['intensity']=='light': h*=.9
    p['target_h']=round(h,1)
    cand=[x for x in days(p['start'],p['end']) if x.weekday()<=5]
    wd=[x for x in cand if x.weekday()<5] or cand[:]
    n=max(3 if p['intensity']=='light' else 4, round(p['target_h']/avg))
    n=min(n,len(cand))
    span_d=max(1,(p['end']-p['start']).days)
    ws=[]
    for x in cand:
        ph=(x-p['start']).days/span_d
        w=1.0
        if x.weekday()==5: w*=0.12*(4 if ph>.75 else 1)
        else: w*=0.95 if ph<.15 else (1.35 if ph>.82 else 1.1+0.35*math.sin(math.pi*ph))
        w*=max(.25,1.35-day_load[x]/450)
        w*=R.uniform(.8,1.25)
        ws.append(w)
    sel=wsample(cand,ws,n)
    deadline=max([x for x in cand if x.weekday()<6])
    if deadline not in sel:
        if sel: sel[0]=deadline
        else: sel=[deadline]
    sel=sorted(set(sel))
    while len(sel)<n:
        extra=[x for x in wd if x not in sel]
        if not extra: break
        sel.append(extra[len(extra)//2]); sel=sorted(set(sel))
    while len(sel)>n: sel.pop(0)
    p['sel']=sel; p['last']=max(sel)
    late=0
    if p['intensity']=='heavy': late=1 if R.random()<.45 else 0
    elif p['intensity']=='medium': late=1 if R.random()<.15 else 0
    elif R.random()<.03: late=1
    if p['client']=='VectorFleet Logistics': late=max(late,1)
    lpool=[x for x in sel if x>=sel[max(0,int(len(sel)*.65)-1)]] if sel else []
    p['late_days']=set([sel[-1]]) if late and sel else set()
    if late>1 and lpool:
        more=[x for x in lpool if x not in p['late_days']]
        if more: p['late_days'].update(wsample(more,[1+i for i,_ in enumerate(more)],min(late-1,len(more))))
    tot=int(round(p['target_h']*60/5))*5
    w2=[]
    for x in sel:
        ph=(x-p['start']).days/span_d
        w=R.uniform(.8,1.3)*(1.28 if ph>.82 else 1.0)*(1.1 if .45<=ph<=.75 else 1.0)
        if x in p['late_days']: w*=R.uniform(1.35,1.85)
        if x.weekday()==5: w*=.75
        w*=max(.35,1.25-day_load[x]/540)
        w2.append(w)
    mins=alloc(tot,w2)
    mn=45 if p['intensity']=='heavy' else (35 if p['intensity']=='medium' else 25)
    for i,m in enumerate(mins):
        floor=60 if (sel[i] in p['late_days'] and p['intensity']!='light') else mn
        if m<floor: mins[i]=floor
    # donor rebalance if totals drift high
    drift=sum(mins)-tot
    while drift>0:
        ds=[i for i,m in enumerate(mins) if m>mn+25]
        if not ds: break
        j=max(ds,key=lambda i:mins[i]); take=min(drift, max(5,((mins[j]-(mn+20))//5)*5))
        mins[j]-=take; drift-=take
    p['m_by_day']={x:m for x,m in zip(sel,mins) if m>0}
    for x,m in p['m_by_day'].items(): day_load[x]+=m
    aw,prim=K[p['kind']]
    p['prim']=prim
    for x,m in p['m_by_day'].items():
        eve=0
        if x in p['late_days'] and m>=120:
            eve=min(m-45, round(R.randint(45,min(110,m-20))/5)*5)
            if eve<60: eve=0
        for win,mm in [('day',m-eve),('evening',eve)]:
            if mm<=0: continue
            ww={a:aw[a]*R.uniform(.85,1.18) for a in aw}
            if win=='evening':
                for a in list(ww):
                    if a in prim: ww[a]*=1.45
                    if a in {'bridge.exe','code.exe'}: ww[a]*=.65
                    if a=='acrobat.exe': ww[a]*=1.15
            else:
                for a in prim: ww[a]*=1.1
            apps=list(ww)
            am=alloc(mm,[ww[a] for a in apps])
            a_map={a:v for a,v in zip(apps,am) if v>=10}
            rem=mm-sum(a_map.values())
            if rem>0: a_map[prim[0]]=a_map.get(prim[0],0)+rem
            if win=='evening' and a_map:
                pairs=sorted(a_map.items(), key=lambda kv: kv[1], reverse=True)
                keep=2 if mm<150 else 3
                spill=sum(v for _,v in pairs[keep:]); a_map=dict(pairs[:keep])
                if spill: a_map[pairs[0][0]]=a_map.get(pairs[0][0],0)+spill
            for a,v in a_map.items():
                left=v; minc,maxc=((35,125) if win=='evening' else (20,110))
                while left>0:
                    if left<=maxc:
                        ch=left if left>=minc or left==v else left
                        if ch<minc and raw[x]: raw[x][-1]['minutes']+=ch
                        else: raw[x].append({'app':a,'minutes':ch,'window':win,'file':pick_file(p,a),'final':x==p['last'],'client':p['client']})
                        left=0
                    else:
                        ch=R.randint(minc,maxc)
                        if 0<left-ch<minc: ch-=minc-(left-ch)
                        ch=max(minc,min(ch,maxc))
                        raw[x].append({'app':a,'minutes':ch,'window':win,'file':pick_file(p,a),'final':x==p['last'],'client':p['client']})
                        left-=ch
        if x==p['last'] and R.random()<.7:
            a='acrobat.exe' if 'acrobat.exe' in aw else prim[0]
            raw[x].append({'app':a,'minutes':15 if x in p['late_days'] else 10,'window':'evening' if (x in p['late_days'] and R.random()<.75) else 'day','file':pick_file(p,a),'final':True,'client':p['client']})

if not raw.get(END):
    p=[p for p in projs if p['client']=='VectorFleet Logistics'][0]
    for a,m,win in [('figma.exe',70,'day'),('code.exe',45,'day'),('figma.exe',60,'evening')]:
        raw[END].append({'app':a,'minutes':m,'window':win,'file':pick_file(p,a),'final':True,'client':p['client']})

for f in OUT.glob('*_fake.json'): f.unlink()
stats={'files':0,'sessions':0,'tot':0,'biz':0,'late':0,'late_final':0,'apps':Counter(),'dates':[],'phours':{}}
for p in projs: stats['phours'][p['name']]=round(sum(p.get('m_by_day',{}).values())/60,1)

for day in sorted(raw):
    segs=[dict(s) for s in raw[day]]
    dse=[s for s in segs if s['window']=='day']; ese=[s for s in segs if s['window']=='evening']
    dse.sort(key=lambda s:(not s['final'],s['client'],R.random())); ese.sort(key=lambda s:(not s['final'],R.random()))
    tot_day=sum(s['minutes'] for s in dse); wd=day.weekday()
    if wd<5:
        cur=R.randint(8*60,8*60+25) if tot_day>=420 else (R.randint(8*60+35,10*60+10) if tot_day<=180 else R.randint(8*60+10,9*60+20))
    elif wd==5: cur=R.randint(9*60+30,12*60)
    else: cur=R.randint(11*60,14*60)
    sched=[]; lunch=False
    def add(seg,start):
        end=start+seg['minutes']; sched.append({**seg,'s':ldt(day,start),'e':ldt(day,end)}); return end
    for i,s in enumerate(dse):
        rem=sum(x['minutes'] for x in dse[i:])
        if wd<5 and not lunch and cur>=12*60 and tot_day>=300 and rem>90: cur+=R.randint(25,55); lunch=True
        cur=add(s,cur)
        if i<len(dse)-1: cur+=R.randint(5,18) if wd<5 else R.randint(8,22)
    if ese:
        ev=max(19*60+R.randint(20,90), cur+R.randint(55,140))
        if any(s['final'] for s in ese): ev=max(ev,20*60+R.randint(15,105))
        cur=ev
        for i,s in enumerate(ese):
            cur=add(s,cur)
            if i<len(ese)-1: cur+=R.randint(5,14)
    apps={}; files=defaultdict(dict)
    for s in sched:
        dur=int((s['e']-s['s']).total_seconds())
        if dur<=0: continue
        a=s['app']
        apps.setdefault(a, {'display_name':APPS[a][0],'total_seconds':0,'sessions':[],'files':[]})
        apps[a]['sessions'].append({'start':fmt(s['s']),'end':fmt(s['e']),'duration_seconds':dur})
        apps[a]['total_seconds']+=dur
        fe=files[a].get(s['file'])
        if not fe: files[a][s['file']]={'name':s['file'],'total_seconds':dur,'fs':s['s'],'ls':s['e']}
        else:
            fe['total_seconds']+=dur; fe['fs']=min(fe['fs'],s['s']); fe['ls']=max(fe['ls'],s['e'])
        stats['sessions']+=1; stats['tot']+=dur; stats['biz']+=overlap(s['s'],s['e']); stats['apps'][a]+=dur
        if s['e'].hour>=23 or s['e'].date()>s['s'].date():
            stats['late']+=1
            if s.get('final'): stats['late_final']+=1
    for a in files:
        apps[a]['sessions'].sort(key=lambda x:x['start'])
        apps[a]['files']=sorted([
            {'name':v['name'],'total_seconds':v['total_seconds'],'first_seen':fmt(v['fs']),'last_seen':fmt(v['ls'])}
            for v in files[a].values()
        ], key=lambda x:(x['name'].lower(),x['first_seen']))
    with (OUT/f'{day.isoformat()}_fake.json').open('w', encoding='utf-8') as fh:
        json.dump({'date':day.isoformat(),'apps':dict(sorted(apps.items()))}, fh, indent=2); fh.write('\n')
    stats['files']+=1; stats['dates'].append(day)

cc=Counter(p['client'] for p in projs)
ratio=(stats['biz']/stats['tot']) if stats['tot'] else 0
if not (25<=len(projs)<=30): raise SystemExit('bad project count')
if max(cc.values())>5: raise SystemExit('client repeated >5')
if min(stats['dates'])>date(2025,6,30): raise SystemExit('start not in June 2025')
if ratio<.80: raise SystemExit(f'business ratio too low: {ratio:.3f}')
if stats['late']<4: raise SystemExit('too few late sessions')
if not (OUT/f'{END.isoformat()}_fake.json').exists(): raise SystemExit('missing today file')

# README summary
lines=['# Fake Data Dataset','','Generated daily tracker JSON files for demo mode.','','- Date range: '+min(stats['dates']).isoformat()+' to '+max(stats['dates']).isoformat(),
       f"- Daily JSON files: {stats['files']}",f"- Projects: {len(projs)}",f"- Fictional clients: {len(cc)} (max repeats per client: {max(cc.values())})",
       f"- Sessions: {stats['sessions']}",f"- Total tracked hours: {stats['tot']/3600:.1f}",f"- Work in 08:00-18:00 window: {ratio*100:.1f}%",
       f"- Late-night sessions (end at 23:00+ or after midnight): {stats['late']}",'','## Applications','']
for a,sec in stats['apps'].most_common(): lines.append(f"- {APPS[a][0]} (`{a}`): {sec/3600:.1f}h")
lines += ['','## Clients and Projects','']
for c in sorted(cc):
    lines.append(f'### {c}')
    for p in sorted([x for x in projs if x['client']==c], key=lambda x:x['start']):
        lines.append(f"- {p['name']} ({p['kind']}, {p['intensity']}, {p['start'].isoformat()} to {p['end'].isoformat()}, ~{stats['phours'][p['name']]:.1f}h)")
    lines.append('')
(OUT/'README.md').write_text('\n'.join(lines).rstrip()+'\n', encoding='utf-8')

print(f"Generated {stats['files']} daily JSON files in {OUT}")
print(f"Date range: {min(stats['dates']).isoformat()} -> {max(stats['dates']).isoformat()}")
print(f"Projects: {len(projs)} | Clients: {len(cc)} | Max client repeats: {max(cc.values())}")
print(f"Sessions: {stats['sessions']} | Total hours: {stats['tot']/3600:.1f}")
print(f"08:00-18:00 ratio: {ratio*100:.1f}%")
print(f"Late-night sessions: {stats['late']} (final-day late sessions: {stats['late_final']})")
print('Top apps:')
for a,sec in stats['apps'].most_common(10): print(f"  - {APPS[a][0]} ({a}): {sec/3600:.1f}h")
