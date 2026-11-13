#!/usr/bin/env python3
"""Checks that a student session is refused by every API route except the practice ones.

Run it against a local API (not AUTH_DISABLED) after seeding a student and a staff session by SQL:

  INSERT INTO users (id, email, name, role) VALUES ('99999999-0000-0000-0000-000000000001','pupil@ucs.org.uk','Pat Pupil','student');
  INSERT INTO sessions (id, user_id, expires_at) VALUES ('student-sid-1','99999999-0000-0000-0000-000000000001', now()+interval '1 day');

  python3 apps/marker/api/scripts/student-fence-sweep.py        # from the repo root

It reads every `router.get/post/...('/path')` in routes/*.ts, calls each one as the student and expects 403 STUDENT_FORBIDDEN.
The routes in routes/practiceStudent.ts (mounted at /api/v1/practice) are for students and are skipped; the teacher side of practice sets (routes/practice.ts) is swept like everything else. Anything else that is not refused is printed and the exit code is 1.
"""
import re, glob, json, sys, urllib.request, urllib.error
U='11111111-1111-1111-1111-111111111111'
def url_for(mount, path):
    p=re.sub(r':(\w+)', lambda m: U, path)
    return 'http://localhost:8080'+mount+p
def call(method, url, sid):
    req=urllib.request.Request(url, data=(b'{}' if method!='GET' else None), method=method, headers={'content-type':'application/json','Cookie':'sid='+sid})
    try:
        r=urllib.request.urlopen(req); return r.status, r.read()[:200]
    except urllib.error.HTTPError as e: return e.code, e.read()[:200]
routes=[]
for f in glob.glob('apps/marker/api/src/routes/*.ts'):
    name=f.split('/')[-1]
    mount={'auth.ts':'/auth','admin.ts':'/admin/v1'}.get(name,'/api/v1')
    for m in re.finditer(r"router\.(get|post|patch|put|delete)\(\s*[`'\"]([^`'\"]+)[`'\"]", open(f).read()):
        path=m.group(2)
        if '${' in path: path=path.replace('${base}','/exams/:examId/compare/:questionId')
        routes.append((name,m.group(1).upper(),mount,path))
routes.append(('index.ts','GET','','/files/?u=/etc/passwd'))
bad=0; counts={}
for name,method,mount,path in routes:
    if name in ('auth.ts','practiceStudent.ts'): continue  # sign-in, and the routes students are meant to use
    st,body=call(method,url_for(mount,path),'student-sid-1')
    code=''
    try: code=json.loads(body).get('code','')
    except Exception: pass
    counts[st]=counts.get(st,0)+1
    if st!=403 or code not in ('STUDENT_FORBIDDEN',):
        bad+=1; print('NOT BLOCKED:',name,method,mount+path,st,code)
print(f'swept {sum(counts.values())} routes as a student: {counts}; not blocked: {bad}')
sys.exit(1 if bad else 0)
