# Drive a real OS mouse drag for the island probe (temporary).
# NOTE: ASCII only on purpose - PowerShell 5.1 reads BOM-less UTF-8 as ANSI
# and non-ASCII chars break parsing.
param(
  [int]$FromX = 508,
  [int]$FromY = 222,
  [int]$Dx = 140,
  [int]$Dy = 120
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
"@

function Move-To([int]$x, [int]$y) {
  [Mouse]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 60
}

Write-Output "[drive] from ($FromX, $FromY)"
Move-To $FromX $FromY

[Mouse]::mouse_event([Mouse]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120

$steps = 8
for ($i = 1; $i -le $steps; $i++) {
  Move-To ($FromX + [int]($Dx * $i / $steps)) ($FromY + [int]($Dy * $i / $steps))
}

Start-Sleep -Milliseconds 120
[Mouse]::mouse_event([Mouse]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "[drive] released"
