Set objShell = CreateObject("Shell.Application")
objShell.ShellExecute "cmd.exe", "/c C:\dev\github\claude-telegram-relay\restart.cmd", "", "runas", 1
