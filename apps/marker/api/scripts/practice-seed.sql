INSERT INTO users (id,email,name,role) VALUES
 ('00000000-0000-0000-0000-00000000000a','lead@ucs.org.uk','Lead Teacher','teacher'),
 ('00000000-0000-0000-0000-00000000000b','second@ucs.org.uk','Second Teacher','teacher'),
 ('00000000-0000-0000-0000-0000000000a1','pupil1@ucs.org.uk','Pupil One','student'),
 ('00000000-0000-0000-0000-0000000000a2','pupil2@ucs.org.uk','Pupil Two','student'),
 ('00000000-0000-0000-0000-0000000000a3','pupil3@ucs.org.uk','Pupil Three (not enrolled)','student');
INSERT INTO sessions (id,user_id,expires_at) VALUES
 ('lead-sid','00000000-0000-0000-0000-00000000000a', now()+interval '1 day'),
 ('second-sid','00000000-0000-0000-0000-00000000000b', now()+interval '1 day'),
 ('p1-sid','00000000-0000-0000-0000-0000000000a1', now()+interval '1 day'),
 ('p2-sid','00000000-0000-0000-0000-0000000000a2', now()+interval '1 day'),
 ('p3-sid','00000000-0000-0000-0000-0000000000a3', now()+interval '1 day');
INSERT INTO exams (id,name,lead_teacher_id,status,use_drive_storage) VALUES ('11111111-1111-1111-1111-111111111111','Secret exam name','00000000-0000-0000-0000-00000000000a','marking',false);
INSERT INTO exam_questions (id,exam_id,question_number,max_marks,ms_clip_image_url) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','1(a)(i)',4,'/tmp/claude-0/-home-user/81864a3c-e09f-5864-aa73-ecfeb3e8ad2b/scratchpad/storage/ms.png'),
 ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','2',3,NULL);
INSERT INTO student_scripts (id,exam_id,student_number,original_pdf_url)
 SELECT ('bbbbbbbb-0000-0000-0000-00000000000'||g)::uuid,'11111111-1111-1111-1111-111111111111','S'||g,'x' FROM generate_series(1,6) g;
INSERT INTO script_clips (id,script_id,question_id,clip_image_url)
 SELECT ('cccccccc-0000-0000-0000-00000000000'||g)::uuid,('bbbbbbbb-0000-0000-0000-00000000000'||g)::uuid,'aaaaaaaa-0000-0000-0000-000000000001','/tmp/claude-0/-home-user/81864a3c-e09f-5864-aa73-ecfeb3e8ad2b/scratchpad/storage/clip1.png' FROM generate_series(1,6) g;
-- lead marks clips 1..6 as 0,1,2,3,4,2 ; second teacher disagrees on clip 3 (gives 4)
INSERT INTO script_marks (clip_id,marker_id,marks_awarded,mark_source,status,marked_at)
 SELECT ('cccccccc-0000-0000-0000-00000000000'||g)::uuid,'00000000-0000-0000-0000-00000000000a',(ARRAY[0,1,2,3,4,2])[g],'human'::mark_source,'marked'::mark_status,now() FROM generate_series(1,6) g;
INSERT INTO script_marks (clip_id,marker_id,marks_awarded,mark_source,status,marked_at) VALUES
 ('cccccccc-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000b',4,'human'::mark_source,'marked'::mark_status,now());
-- an AI mark on clip 6 (must never be a reference) and nothing else
INSERT INTO script_marks (clip_id,marker_id,marks_awarded,mark_source,status,marked_at)
 VALUES ('cccccccc-0000-0000-0000-000000000006',NULL,1,'ai'::mark_source,'marked'::mark_status,now()) ON CONFLICT DO NOTHING;
