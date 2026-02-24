from flask import Flask, jsonify
from datetime import datetime

app = Flask(__name__)

STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {},
    "war": {}
}

@app.route("/")
def index():
    return jsonify(STATE)

@app.route("/api/sheet")
def sheet():
    return jsonify(STATE)
