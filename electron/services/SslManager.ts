import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { ConfigStore } from "./ConfigStore";

const execAsync = promisify(exec);

const CA_SUBJECT = "CN=DevStack Local CA";

/**
 * 为本机开发域名签发 HTTPS 证书：维护一张 DevStack 本地 CA，
 * 给站点签叶子证书（Nginx PEM），并把 CA 导入 Windows 受信任根证书。
 */
export class SslManager {
  constructor(private configStore: ConfigStore) {}

  getCaDir(): string {
    return join(this.configStore.getSSLPath(), "_ca");
  }

  getSiteDir(domain: string): string {
    return join(this.configStore.getSSLPath(), domain);
  }

  siteCertPaths(domain: string): { chain: string; key: string } {
    const dir = this.getSiteDir(domain);
    return {
      chain: join(dir, `${domain}-chain.pem`),
      key: join(dir, `${domain}-key.pem`),
    };
  }

  async ensureSiteCertificate(
    domain: string,
    force = false,
  ): Promise<{ success: boolean; message: string }> {
    const host = (domain || "").trim().toLowerCase();
    if (!host || /[^\w.-]/.test(host)) {
      return { success: false, message: `无效域名: ${domain}` };
    }

    const { chain, key } = this.siteCertPaths(host);
    if (!force && existsSync(chain) && existsSync(key)) {
      await this.trustLocalCa();
      return {
        success: true,
        message: `已使用已有证书 ${chain}`,
      };
    }

    const sslRoot = this.configStore.getSSLPath();
    const caDir = this.getCaDir();
    const siteDir = this.getSiteDir(host);
    for (const dir of [sslRoot, caDir, siteDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    const tempDir = this.configStore.getTempPath();
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    const argsPath = join(tempDir, "ssl-issue.json");
    const scriptPath = join(tempDir, "ssl-issue.ps1");
    writeFileSync(
      argsPath,
      JSON.stringify({
        domain: host,
        caSubject: CA_SUBJECT,
        caDir,
        siteDir,
        chainPath: chain,
        keyPath: key,
      }),
      "utf-8",
    );
    writeFileSync(scriptPath, "\uFEFF" + this.buildScript(), "utf-8");

    try {
      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -ArgsFile "${argsPath}"`,
        { windowsHide: true, timeout: 60000 },
      );
      const out = `${stdout || ""}\n${stderr || ""}`.trim();
      if (!existsSync(chain) || !existsSync(key)) {
        return {
          success: false,
          message: `证书文件未生成: ${out || "未知错误"}`,
        };
      }
      return {
        success: true,
        message: `已为 ${host} 生成本地 HTTPS 证书，并导入 Windows 受信任根证书`,
      };
    } catch (e: any) {
      return {
        success: false,
        message: `生成证书失败: ${e.message}`,
      };
    } finally {
      try {
        unlinkSync(scriptPath);
      } catch {
        // 忽略
      }
      try {
        unlinkSync(argsPath);
      } catch {
        // 忽略
      }
    }
  }

  /** 仅把已有 CA 再导入一次根存储（证书已存在时调用）。 */
  private async trustLocalCa(): Promise<void> {
    const cer = join(this.getCaDir(), "devstack-ca.cer");
    if (!existsSync(cer)) return;
    try {
      await execAsync(`certutil -addstore -f Root "${cer}"`, {
        windowsHide: true,
        timeout: 15000,
      });
    } catch {
      // 已存在或无管理员权限时忽略
    }
  }

  private buildScript(): string {
    return `
param([string]$ArgsFile)
$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$cfg = Get-Content -Raw -Path $ArgsFile | ConvertFrom-Json
$domain = [string]$cfg.domain
$caSubject = [string]$cfg.caSubject
$caDir = [string]$cfg.caDir
$siteDir = [string]$cfg.siteDir
$chainPath = [string]$cfg.chainPath
$keyPath = [string]$cfg.keyPath

function To-PemCert([System.Security.Cryptography.X509Certificates.X509Certificate2]$cert) {
  $nl = [Environment]::NewLine
  $bytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
  $b64 = [Convert]::ToBase64String($bytes, [System.Base64FormattingOptions]::InsertLineBreaks)
  return ("-----BEGIN CERTIFICATE-----" + $nl + $b64 + $nl + "-----END CERTIFICATE-----")
}

function To-PemKey([System.Security.Cryptography.X509Certificates.X509Certificate2]$cert) {
  $nl = [Environment]::NewLine
  $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
  if ($null -eq $rsa) { throw "无法读取私钥" }
  $cng = [System.Security.Cryptography.RSACng]$rsa
  $blob = $cng.Key.Export([System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)
  $b64 = [Convert]::ToBase64String($blob, [System.Base64FormattingOptions]::InsertLineBreaks)
  return ("-----BEGIN PRIVATE KEY-----" + $nl + $b64 + $nl + "-----END PRIVATE KEY-----")
}

if (-not (Test-Path $caDir)) { New-Item -ItemType Directory -Path $caDir -Force | Out-Null }
if (-not (Test-Path $siteDir)) { New-Item -ItemType Directory -Path $siteDir -Force | Out-Null }

$ca = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -eq $caSubject } | Select-Object -First 1
if (-not $ca) {
  $ca = New-SelfSignedCertificate -Type Custom \`
    -Subject $caSubject \`
    -KeyUsage CertSign, CRLSign, DigitalSignature \`
    -KeyExportPolicy Exportable \`
    -KeyProtection None \`
    -KeyLength 2048 \`
    -HashAlgorithm SHA256 \`
    -NotAfter (Get-Date).AddYears(10) \`
    -CertStoreLocation Cert:\\CurrentUser\\My \`
    -TextExtension @('2.5.29.19={critical}{text}ca=true&pathlength=1')
}

$cerPath = Join-Path $caDir 'devstack-ca.cer'
Export-Certificate -Cert $ca -FilePath $cerPath | Out-Null

$trusted = Get-ChildItem Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq $caSubject }
if (-not $trusted) {
  & certutil -addstore -f Root $cerPath | Out-Null
}
$userTrusted = Get-ChildItem Cert:\\CurrentUser\\Root -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq $caSubject }
if (-not $userTrusted) {
  & certutil -user -addstore -f Root $cerPath | Out-Null
}

# 清掉同域名旧叶子证，避免商店里堆重复
Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -eq "CN=$domain" } | ForEach-Object {
  Remove-Item $_.PSPath -Force -ErrorAction SilentlyContinue
}

$site = New-SelfSignedCertificate -Type Custom \`
  -Subject "CN=$domain" \`
  -DnsName $domain \`
  -KeyExportPolicy Exportable \`
  -KeyProtection None \`
  -KeyLength 2048 \`
  -HashAlgorithm SHA256 \`
  -NotAfter (Get-Date).AddYears(3) \`
  -CertStoreLocation Cert:\\CurrentUser\\My \`
  -Signer $ca \`
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1')

$nl = [Environment]::NewLine
$chain = (To-PemCert $site) + $nl + (To-PemCert $ca)
$key = To-PemKey $site
[System.IO.File]::WriteAllText($chainPath, $chain)
[System.IO.File]::WriteAllText($keyPath, $key)

# 叶子证不必留在个人存储
Remove-Item $site.PSPath -Force -ErrorAction SilentlyContinue

Write-Output "OK domain=$domain"
`.trim();
  }
}
