// Persistent anonymous user id for the Windows shell, stored in Windows Credential Manager.
//
// Credential Manager lives outside the app's own data folders, so the id survives
// clearing app data / cache / WebView2 profile, and even uninstall + reinstall.
// It is per Windows user account (a second Windows user on the same PC is a second user).
//
// Works for packaged (MSIX) and unpackaged WPF / WinForms / WinUI apps. Target: .NET 6+.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace Beu.Syllabus.Identity;

public static class PersistentUserId
{
    private const string Target = "BEUSyllabus/UserId";
    private const string UserName = "beu-user";
    private static readonly Regex IdRe = new("^[A-Za-z0-9_-]{8,64}$", RegexOptions.Compiled);
    private static readonly object Gate = new();
    private static string? _cached;

    /// <summary>Returns the persistent id, creating and storing it on first ever call.</summary>
    public static string Get()
    {
        if (_cached is not null) return _cached;
        lock (Gate)
        {
            if (_cached is not null) return _cached;

            var id = Read();
            if (id is null)
            {
                id = Guid.NewGuid().ToString();
                Write(id); // throws Win32Exception if Credential Manager refuses
            }
            return _cached = id;
        }
    }

    /// <summary>
    /// Call once, right after CoreWebView2 is ready and BEFORE the first Navigate().
    /// Injects window.BEU_NATIVE_ID / BEU_PLATFORM ahead of every page script,
    /// which is exactly what js/tracker.js reads.
    /// </summary>
    public static Task InstallAsync(CoreWebView2 webView)
    {
        var script =
            $"window.BEU_NATIVE_ID={JsonSerializer.Serialize(Get())};" +
            "window.BEU_PLATFORM='windows';";
        return webView.AddScriptToExecuteOnDocumentCreatedAsync(script);
    }

    // ------------------------------------------------------------------ Win32

    private const uint CRED_TYPE_GENERIC = 1;
    private const uint CRED_PERSIST_LOCAL_MACHINE = 2; // survives reboot, does not roam
    private const int ERROR_NOT_FOUND = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", SetLastError = false)]
    private static extern void CredFree(IntPtr buffer);

    private static string? Read()
    {
        if (!CredRead(Target, CRED_TYPE_GENERIC, 0, out var ptr))
        {
            int err = Marshal.GetLastWin32Error();
            if (err == ERROR_NOT_FOUND) return null;
            throw new Win32Exception(err);
        }
        try
        {
            var cred = Marshal.PtrToStructure<CREDENTIAL>(ptr);
            if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize == 0) return null;

            var bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
            var id = Encoding.UTF8.GetString(bytes);
            return IdRe.IsMatch(id) ? id : null; // tampered / corrupt entry -> regenerate
        }
        finally
        {
            CredFree(ptr);
        }
    }

    private static void Write(string id)
    {
        var bytes = Encoding.UTF8.GetBytes(id);
        var blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var cred = new CREDENTIAL
            {
                Type = CRED_TYPE_GENERIC,
                TargetName = Target,
                UserName = UserName,
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blob,
                Persist = CRED_PERSIST_LOCAL_MACHINE,
            };
            if (!CredWrite(ref cred, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            Marshal.FreeHGlobal(blob);
        }
    }
}

/* Usage (WPF/WinForms code-behind):

   await webView.EnsureCoreWebView2Async();
   await PersistentUserId.InstallAsync(webView.CoreWebView2);
   webView.CoreWebView2.Navigate("https://mdzafar864.github.io/BEU-Syllabus-App/");
*/
