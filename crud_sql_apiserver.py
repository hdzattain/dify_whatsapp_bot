from flask import Flask, request, jsonify
from pymysql import connect
from pymysql.err import IntegrityError, DataError
import pymysql.cursors
import re
from datetime import datetime, date
import uuid
from dateutil import parser as date_parser

app = Flask(__name__)

# --- Config ---
DB_CONFIG = {
    "host": "rm-3ns8u64164878eu6i6o.mysql.rds.aliyuncs.com",
    "port": 3306,
    "user": "aitest",
    "password": "G4!u7G231a1o",
    "database": "ai_test",
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor
}

TABLE_NAME = "your_table_name"
FIELDS = [
    "id", "sys_platform", "uuid", "bstudio_create_time",
    "location", "number", "floor", "morning",
    "afternoon", "xiaban", "subcontrator"
]

# --- DB Utility ---
def get_conn():
    return connect(**DB_CONFIG)

def execute_query(sql, params=(), fetch=False, many=False):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params) if not many else cur.executemany(sql, params)
            if fetch:
                return cur.fetchall()
            conn.commit()
            return cur.rowcount
    finally:
        conn.close()

def normalize_date(value):
    try:
        dt = date_parser.parse(value)
        return dt.strftime("%Y-%m-%d")
    except:
        return None

# --- Routes ---
@app.route("/records", methods=["POST"])
def create_record():
    data = request.get_json(force=True)
    record = {}

    record["id"] = data.get("id") or int(datetime.utcnow().timestamp())
    record["uuid"] = data.get("uuid") or str(uuid.uuid4())

    for field in FIELDS:
        if field not in record:
            record[field] = data.get(field)

    # Normalize time format
    if record.get("bstudio_create_time"):
        try:
            dt = date_parser.parse(record["bstudio_create_time"])
            record["bstudio_create_time"] = dt.strftime("%Y-%m-%d %H:%M:%S")
        except:
            record["bstudio_create_time"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    else:
        record["bstudio_create_time"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    cols = ", ".join(f"`{f}`" for f in FIELDS)
    placeholders = ", ".join(["%s"] * len(FIELDS))
    values = tuple(record[f] for f in FIELDS)
    sql = f"INSERT INTO `{TABLE_NAME}` ({cols}) VALUES ({placeholders})"

    try:
        execute_query(sql, values)
    except IntegrityError as e:
        return jsonify({"error": "主键冲突", "detail": str(e)}), 400
    except DataError as e:
        return jsonify({"error": "数据错误", "detail": str(e)}), 400

    return jsonify({"status": "ok", "inserted_id": record["id"]}), 201

@app.route("/records/<int:record_id>", methods=["GET"])
def get_record(record_id):
    sql = f"SELECT * FROM `{TABLE_NAME}` WHERE `id`=%s"
    rows = execute_query(sql, (record_id,), fetch=True)
    return jsonify(rows[0]) if rows else (jsonify({"error": "未找到该记录"}), 404)

@app.route("/records", methods=["GET"])
def list_records():
    sql = f"SELECT * FROM `{TABLE_NAME}` ORDER BY `id`"
    return jsonify(execute_query(sql, fetch=True))

@app.route("/records/today", methods=["GET"])
def get_today_records():
    today_str = date.today().strftime("%Y-%m-%d")
    start_time = f"{today_str} 00:00:00"
    end_time = f"{today_str} 23:59:59"
    sql = f"SELECT * FROM `{TABLE_NAME}` WHERE `bstudio_create_time` BETWEEN %s AND %s ORDER BY `id`"
    return jsonify(execute_query(sql, (start_time, end_time), fetch=True))

@app.route("/records/update_by_condition", methods=["PUT"])
def update_by_condition():
    data = request.get_json(force=True)
    filters = data.get("where")
    updates = data.get("set")

    if not filters or not updates:
        return jsonify({"error": "请提供 'where' 和 'set' 字段"}), 400

    conditions = []
    params = []
    for key, value in filters.items():
        if key in FIELDS:
            if key == "bstudio_create_time":
                norm = normalize_date(value)
                if norm:
                    start, end = f"{norm} 00:00:00", f"{norm} 23:59:59"
                    conditions.append(f"`{key}` BETWEEN %s AND %s")
                    params.extend([start, end])
                    continue
            conditions.append(f"`{key}` = %s")
            params.append(value)

    if not conditions:
        return jsonify({"error": "无有效过滤条件字段"}), 400

    update_clause = []
    update_params = []
    for key, value in updates.items():
        if key in FIELDS:
            update_clause.append(f"`{key}` = %s")
            update_params.append(value)
    if not update_clause:
        return jsonify({"error": "无可更新字段"}), 400

    sql = f"UPDATE `{TABLE_NAME}` SET {', '.join(update_clause)} WHERE {' AND '.join(conditions)}"
    total_params = tuple(update_params + params)
    count = execute_query(sql, total_params)

    if count == 0:
        return jsonify({"error": "未找到匹配记录"}), 404
    return jsonify({"status": "ok", "updated_count": count})

@app.route("/records/<int:record_id>", methods=["PUT"])
def update_record(record_id):
    data = request.get_json(force=True)
    updates = [f"`{k}`=%s" for k in data if k in FIELDS and k != "id"]
    if not updates:
        return jsonify({"error": "无可更新字段"}), 400

    sql = f"UPDATE `{TABLE_NAME}` SET {', '.join(updates)} WHERE `id`=%s"
    params = tuple(data[k] for k in data if k in FIELDS and k != "id") + (record_id,)

    if execute_query(sql, params) == 0:
        return jsonify({"error": "未找到该记录"}), 404
    return jsonify({"status": "ok", "updated_id": record_id})

@app.route("/records", methods=["DELETE"])
def delete_records():
    filters = request.get_json(silent=True) or request.args.to_dict()
    if not filters:
        return jsonify({"error": "请提供过滤条件"}), 400

    conditions, params = [], []
    for key, value in filters.items():
        if key in FIELDS:
            if key == "bstudio_create_time":
                norm = normalize_date(value)
                if norm:
                    start, end = f"{norm} 00:00:00", f"{norm} 23:59:59"
                    conditions.append(f"`{key}` BETWEEN %s AND %s")
                    params.extend([start, end])
                    continue
            conditions.append(f"`{key}` = %s")
            params.append(value)

    if not conditions:
        return jsonify({"error": "没有有效过滤字段"}), 400

    sql = f"DELETE FROM `{TABLE_NAME}` WHERE {' AND '.join(conditions)}"
    deleted = execute_query(sql, params)
    if deleted == 0:
        return jsonify({"error": f"未找到匹配的记录"}), 404
    return jsonify({"status": "ok", "deleted_count": deleted})
    rows = execute_query("SHOW TABLES", fetch=True)
    return jsonify({"tables": [list(row.values())[0] for row in rows]})

@app.route("/columns", methods=["GET"])
def show_columns():
    table = request.args.get("table")
    if not table:
        return jsonify({"error": "请提供表名"}), 400
    sql = f"SHOW COLUMNS FROM `{table}`"
    rows = execute_query(sql, fetch=True)
    return jsonify({"columns": [row["Field"] for row in rows]})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
