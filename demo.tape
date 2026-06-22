# Demo recording for the README. One command on a machine with VHS installed:
#   brew install vhs        # (pulls in ttyd + ffmpeg)
#   vhs demo.tape           # -> demo.gif
#
# The Hidden block builds a sample repo and warms the npx cache so the visible
# part is just ctxdiet running. Nothing here touches your real projects.
Output demo.gif

Set FontSize 16
Set Width 1120
Set Height 680
Set Padding 20
Set Theme "Dracula"

Hide
Type "bash demo/setup.sh" Enter
Sleep 3s
Type "cd /tmp/ctxdiet-demo && npx -y ctxdiet@latest --version >/dev/null 2>&1 && clear" Enter
Sleep 2s
Show

Type "npx ctxdiet" Sleep 500ms Enter
Sleep 4s

Type "npx ctxdiet fix" Sleep 500ms Enter
Sleep 1500ms
Type "y" Enter
Sleep 5s
