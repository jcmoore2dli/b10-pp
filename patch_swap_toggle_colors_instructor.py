path = "frontend/src/screens/InstructorDashboardScreen.jsx"
with open(path) as f:
    content = f.read()

old = """              backgroundColor: instrRole === 'main' ? '#d97706' : '#0d9488',
              borderColor: instrRole === 'main' ? '#f59e0b' : '#5eead4',"""
new = """              backgroundColor: instrRole === 'main' ? '#0d9488' : '#d97706',
              borderColor: instrRole === 'main' ? '#5eead4' : '#f59e0b',"""

count = content.count(old)
assert count == 1, f"Expected 1 match, found {count}"
content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("Patched OK")
