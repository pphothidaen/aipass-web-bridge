# ===============================================================
# Middle Gateway / Secretary — files
# ===============================================================
# Components:
#   packages/secretary.py         — core routing + consultant + execution + self-heal
#   packages/secretary-agent      — CLI wrapper for run / dry-run / skill commands
#   skills/                       — stored successful plans (gitignored recommended)

# Enable with:
#   python3 packages/secretary-agent run "<request>"
#   python3 packages/secretary-agent dry-run "<request>"
#   python3 packages/secretary-agent skills list
#   python3 packages/secretary-agent skills show <hash>
