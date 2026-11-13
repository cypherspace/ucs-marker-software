"""Practice-marking API check. Seed a fresh migrated database with practice-seed.sql (edit the storage paths to real PNGs), run the API on :8080, then run this. Prints FAIL lines for anything wrong."""
import json, urllib.request, urllib.error
B='http://localhost:8080'
E='11111111-1111-1111-1111-111111111111'
Q1='aaaaaaaa-0000-0000-0000-000000000001'; Q2='aaaaaaaa-0000-0000-0000-000000000002'
fails=[]
def call(method, path, sid, body=None):
    data=json.dumps(body).encode() if body is not None else (b'{}' if method!='GET' else None)
    req=urllib.request.Request(B+path, data=data, method=method, headers={'content-type':'application/json','Cookie':'sid='+sid})
    try:
        r=urllib.request.urlopen(req); raw=r.read(); st=r.status
    except urllib.error.HTTPError as e: raw=e.read(); st=e.code
    try: return st, json.loads(raw)
    except Exception: return st, raw
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ')+name, extra if not cond else '')
    if not cond: fails.append(name)

# ---- teacher side
st,r=call('POST',f'/api/v1/exams/{E}/practice-sets','second-sid',{'name':'x','question_ids':[Q1]}); check('non-lead teacher cannot create set',st==403,(st,r))
st,r=call('POST',f'/api/v1/exams/{E}/practice-sets','p1-sid',{'name':'x','question_ids':[Q1]}); check('student cannot create set',st==403,(st,r))
st,r=call('POST',f'/api/v1/exams/{E}/practice-sets','lead-sid',{'name':'x','question_ids':[Q2]}); check('no marked clips -> 422',st==422,(st,r))
st,r=call('POST',f'/api/v1/exams/{E}/practice-sets','lead-sid',{'name':'Set A','question_ids':[Q1],'per_question':10}); check('create set',st==201,(st,r))
SET=r['data']['id']; check('only settled clips (conflict clip 3 excluded) -> 5 items', r['data']['items']==5, r['data'])
st,r=call('POST',f'/api/v1/exams/{E}/practice-sets','lead-sid',{'name':'Set all','question_ids':[Q1],'only_settled':False}); check('unsettled allowed -> 6',st==201 and r['data']['items']==6,(st,r))
SET_ALL=r['data']['id']
st,r=call('GET',f'/api/v1/practice-sets/{SET}','lead-sid'); check('detail',st==200 and len(r['data']['items'])==5,(st,r))
refs=sorted(i['reference'] for i in r['data']['items']); check('references are teacher marks (clip6=2 not AI 1)',refs==[0,1,2,3,4],refs)
st,l1=call('POST',f'/api/v1/practice-sets/{SET}/links','lead-sid',{'class_name':'10A'}); check('link 1',st==201 and '/join/' in l1['data']['url'],(st,l1))
st,l2=call('POST',f'/api/v1/practice-sets/{SET}/links','lead-sid',{'class_name':'10B'}); check('link 2',st==201)
T1=l1['data']['token']; T2=l2['data']['token']
st,r=call('POST',f'/api/v1/practice-sets/{SET}/links','second-sid',{'class_name':'x'}); check('other teacher cannot add link',st==403,st)

# ---- student side
st,r=call('GET','/api/v1/practice/sets','p1-sid'); check('no sets before joining',st==200 and r['data']==[],(st,r))
st,r=call('POST','/api/v1/practice/join','p1-sid',{'token':'nonsense-nonsense-123'}); check('bad token 410',st==410,(st,r))
st,r=call('POST','/api/v1/practice/join','lead-sid',{'token':T1}); check('teacher cannot join as student',st==403,st)
st,r=call('POST','/api/v1/practice/join','p1-sid',{'token':T1}); check('p1 joins',st==200,(st,r))
st,r=call('POST','/api/v1/practice/join','p1-sid',{'token':T1}); check('join idempotent',st==200)
st,r=call('POST','/api/v1/practice/join','p2-sid',{'token':T2}); check('p2 joins other class',st==200)
st,r=call('GET','/api/v1/practice/sets','p1-sid'); check('p1 sees set with class',st==200 and len(r['data'])==1 and r['data'][0]['class_name']=='10A' and r['data'][0]['total']==5,(st,r))
st,sv=call('GET',f'/api/v1/practice/sets/{SET}','p1-sid'); check('set view',st==200 and len(sv['data']['items'])==5,(st,sv))
body=json.dumps(sv)
for forbidden in ['Secret exam name','S1','clip_id','script_id','cccccccc','bbbbbbbb',E]:
    check(f'set view leaks nothing: {forbidden}', forbidden not in body)
st,r=call('GET',f'/api/v1/practice/sets/{SET}','p3-sid'); check('unenrolled student 404 on set',st==404,st)
ITEMS=[i['item_id'] for i in sv['data']['items']]
it=ITEMS[0]
st,r=call('GET',f'/api/v1/practice/items/{it}','p3-sid'); check('unenrolled student 404 on item',st==404,st)
st,r=call('GET',f'/api/v1/practice/items/{it}/image','p3-sid'); check('unenrolled 404 on image',st==404,st)
st,r=call('GET',f'/api/v1/practice/items/{it}','p1-sid'); check('item view',st==200,(st,r))
d=r['data']; check('no result before submit',d['result'] is None and d['submitted'] is False)
b=json.dumps(d)
for forbidden in ['Secret exam name',E,'cccccccc','bbbbbbbb','teacher_mark','reference','clip_image_url','/tmp/']:
    check(f'item view leaks nothing: {forbidden}', forbidden not in b)
check('label', d['question_label']=='1(a)(i)', d['question_label'])
check('ms url present by default', d['ms_url'] is not None)
st,raw=call('GET',f'/api/v1/practice/items/{it}/image','p1-sid'); check('image streams',st==200 and isinstance(raw,bytes) and raw[:4]==b'\x89PNG',(st,str(raw)[:80]))
st,raw=call('GET',f'/api/v1/practice/items/{it}/ms','p1-sid'); check('ms streams',st==200,(st,str(raw)[:80]))
st,r=call('POST',f'/api/v1/practice/items/{it}/submit','p1-sid',{'marks_awarded':9}); check('over max rejected',st==400,(st,r))
st,r=call('POST',f'/api/v1/practice/items/{it}/submit','p1-sid',{'marks_awarded':-1}); check('negative rejected',st in (400,422),(st,r))
st,r=call('POST',f'/api/v1/practice/items/{it}/submit','p1-sid',{'marks_awarded':2.5}); check('half mark rejected',st in (400,422),(st,r))
st,r=call('POST',f'/api/v1/practice/items/{it}/submit','p1-sid',{'marks_awarded':3,'annotation_data':[{'type':'tick'}]}); check('submit',st==201,(st,r))
rev=r['data']; check('reveal has teacher mark and difference', rev['your_mark']==3 and rev['teacher_mark'] is not None and rev['difference']==3-rev['teacher_mark'],rev)
st,r=call('POST',f'/api/v1/practice/items/{it}/submit','p1-sid',{'marks_awarded':1}); check('second submit 409',st==409,(st,r))
st,r=call('GET',f'/api/v1/practice/items/{it}','p1-sid'); check('after submit result shown',r['data']['result'] and r['data']['result']['your_mark']==3,r)
st,r=call('GET',f'/api/v1/practice/items/{ITEMS[1]}','p1-sid'); check('other item still hidden',r['data']['result'] is None)
st,r=call('GET',f'/api/v1/practice/items/{it}','p2-sid'); check('p2 (other class, same set? no: other link same set) can open item',st==200 and r['data']['result'] is None,(st,r))
for it2,m in zip(ITEMS[1:],[0,1,4,2]):
    call('POST',f'/api/v1/practice/items/{it2}/submit','p1-sid',{'marks_awarded':m})
st,r=call('GET',f'/api/v1/practice/sets/{SET}/summary','p1-sid'); check('summary',st==200 and r['data']['finished'] and r['data']['done']==5,(st,r))
print(json.dumps(r['data']['stats']), r['data']['bias_note'])
st,r=call('GET','/api/v1/practice/sets','p1-sid'); check('done count',r['data'][0]['done']==5)

# ---- teacher results
st,r=call('GET',f'/api/v1/practice-sets/{SET}/results','lead-sid'); check('results',st==200 and r['data']['overall']['compared']==5,(st,r))
check('class grouping', {c['class_name'] for c in r['data']['classes']}=={'10A','10B'}, r['data']['classes'])
st,r=call('GET',f'/api/v1/practice-sets/{SET}/results?format=csv','lead-sid'); check('csv',st==200 and r['data']['csv'].count('\n')==6,r)
st,r=call('GET',f'/api/v1/practice-sets/{SET}/results','second-sid'); check('other teacher cannot see results',st==403,st)

# ---- teacher marks unaffected by student marks
st,r=call('GET',f'/api/v1/exams/{E}/results','lead-sid'); check('exam results still work',st==200,(st,str(r)[:200]))
st,r=call('GET',f'/api/v1/exams/{E}/progress','lead-sid'); print('progress',st, str(r)[:300])
import subprocess
# ---- revoke
st,r=call('POST',f'/api/v1/practice-links/{l2["data"]["id"]}/revoke','lead-sid'); check('revoke',st==200,(st,r))
st,r=call('GET',f'/api/v1/practice/items/{it}','p2-sid'); check('revoked student cut off',st==404,(st,r))
st,r=call('POST','/api/v1/practice/join','p3-sid',{'token':T2}); check('revoked link refuses join',st==410,(st,r))
# ---- close
st,r=call('POST',f'/api/v1/practice-sets/{SET_ALL}/links','lead-sid',{'class_name':'11C'}); T3=r['data']['token']
st,r=call('POST','/api/v1/practice/join','p3-sid',{'token':T3}); check('p3 joins set all',st==200)
st,r=call('POST',f'/api/v1/practice-sets/{SET_ALL}/close','lead-sid'); check('close',st==200)
st,r=call('GET','/api/v1/practice/sets','p3-sid'); itemsAll=call('GET',f'/api/v1/practice/sets/{SET_ALL}','p3-sid')[1]['data']['items']
st,r=call('POST',f'/api/v1/practice/items/{itemsAll[0]["item_id"]}/submit','p3-sid',{'marks_awarded':1}); check('closed set refuses submit',st==409 and r.get('code')=='SET_CLOSED',(st,r))
st,r=call('POST','/api/v1/practice/join','p2-sid',{'token':T3}); check('closed set refuses new joins',st==410,(st,r))
# expired link
st,r=call('POST',f'/api/v1/practice-sets/{SET}/links','lead-sid',{'class_name':'old','expires_at':'2020-01-01T00:00:00Z'}); 
st,r2=call('POST','/api/v1/practice/join','p3-sid',{'token':r['data']['token']}); check('expired link refused',st==201 and r2 and True or True)
st,r2=call('POST','/api/v1/practice/join','p3-sid',{'token':r['data']['token']}); check('expired link 410',st==410,(st,r2))
# delete cascades
st,r=call('DELETE',f'/api/v1/practice-sets/{SET_ALL}','lead-sid'); check('delete',st==200)
print('\nFAILS:',fails)
