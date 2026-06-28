path = "frontend/src/screens/PassageMenuScreen.jsx"
with open(path) as f:
    content = f.read()

old = "style={{ backgroundColor: passage.assignmentType === 'slt' ? '#0d9488' : '#d97706' }}"
new = "style={{ backgroundColor: passage.assignmentType === 'slt' ? '#d97706' : '#0d9488' }}"

count = content.count(old)
assert count == 1, f"Expected 1 match, found {count}"
content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("Patched OK")
