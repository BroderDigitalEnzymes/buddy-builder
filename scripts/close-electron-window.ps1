param([int[]]$Pids)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class Win32WindowOps {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

$closed = 0
foreach ($targetPid in $Pids) {
    [Win32WindowOps]::EnumWindows({
        param($hWnd, $lParam)
        $windowPid = [uint32]0
        [Win32WindowOps]::GetWindowThreadProcessId($hWnd, [ref]$windowPid) | Out-Null
        if ([int]$windowPid -eq $targetPid -and [Win32WindowOps]::IsWindowVisible($hWnd)) {
            $sb = New-Object System.Text.StringBuilder 256
            [Win32WindowOps]::GetWindowText($hWnd, $sb, 256) | Out-Null
            $title = $sb.ToString()
            if ($title -and $title.Length -gt 0) {
                [Win32WindowOps]::PostMessage($hWnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
                Write-Host "Sent WM_CLOSE to PID=$targetPid Title='$title'"
                $script:closed++
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null
}
Write-Host "Closed $closed window(s)"
