# file: insert_api.py
from flask import Flask, request, jsonify
import pymysql

app = Flask(__name__)

# 这里填你的数据库连接信息
DB_CONFIG = {
    "host": "mysql2.sqlpub.com",
    "port": 3307,
    "user": "epermit",
    "password": "asyPoLpQPkpyxAw9",
    "database": "epermit",
    "charset": "utf8mb4"
}

@app.route("/insert", methods=["POST"])
def insert():
    data = request.json
    # 你要插入的表和列
    sql = """
      INSERT INTO your_table_name
        (id, sys_platform, uuid, bstudio_create_time, location, number, floor, morning, afternoon, xiaban)
      VALUES
        (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    params = (
        data["id"],
        data["sys_platform"],
        data["uuid"],
        data["bstudio_create_time"],
        data["location"],
        data["number"],
        data["floor"],
        data["morning"],
        data["afternoon"],
        data["xiaban"],
    )
    conn = pymysql.connect(**DB_CONFIG)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        conn.commit()
    conn.close()
    return jsonify({"status": "ok", "inserted_id": data["id"]})

@app.route("/tables", methods=["GET"])
def show_tables():
    conn = pymysql.connect(**DB_CONFIG)
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES")
        tables = [row[0] for row in cur.fetchall()]
    conn.close()
    return jsonify({"tables": tables})

@app.route("/columns", methods=["GET"])
def show_columns():
    table = request.args.get("table")
    if not table:
        return jsonify({"error": "请提供表名参数 ?table=xxx"}), 400
    conn = pymysql.connect(**DB_CONFIG)
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM `{table}`")
        columns = [row[0] for row in cur.fetchall()]
    conn.close()
    return jsonify({"columns": columns})

if __name__ == "__main__":
    # 在 0.0.0.0:5000 上监听
    app.run(host="0.0.0.0", port=5000)
