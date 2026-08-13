"""
One-off cleanup — maintenance_db ki purani/atki (zombie) connections band karo.

Kyun: diagnosis ke dauraan backend baar-baar restart-kill hua; ANDON poll ki ek
DB transaction beech me kat gayi aur connection `idle in transaction` reh gayi jo
`andon_plc_output_mapping` par lock pakde baithi hai.  Us wajah se naye backend ki
startup migration (ALTER TABLE / CREATE INDEX) block ho jaati hai aur backend
"Waiting for application startup" par hang ho jaata hai -> login fail.

Safe: `maintenance_db` sirf isi app ki DB hai; ye connections sab is app ke mare
hue backends ki hain.  Chalao, phir START.bat.
"""
import os
import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
db = os.getenv("DB_NAME")

conn = psycopg2.connect(
    host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"), dbname=db,
    user=os.getenv("DB_USER"), password=os.getenv("DB_PASS"), connect_timeout=6,
)
conn.autocommit = True
cur = conn.cursor()

cur.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()", (db,))
print("before :", cur.fetchone()[0], "connections")

cur.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()", (db,))
print("cleared:", cur.rowcount, "connections")

cur.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
print("waiting locks now:", cur.fetchone()[0])

print("DONE - ab START.bat chalao (backend ab bina atke start hoga, login chalega)")
