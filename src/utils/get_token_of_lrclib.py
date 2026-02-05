import hashlib

def solve_challenge(prefix, target):
    nonce = 0
    while True:
        attempt = f"{prefix}{nonce}"
        result = hashlib.sha256(attempt.encode()).hexdigest()
        
        if result < target:
            print(f"✅ Đã tìm thấy Nonce: {nonce}")
            print(f"🚀 X-Publish-Token: {prefix}:{nonce}")
            return f"{prefix}:{nonce}"
        nonce += 1

prefix_from_api = ""
target_from_api = ""

solve_challenge(prefix_from_api, target_from_api)