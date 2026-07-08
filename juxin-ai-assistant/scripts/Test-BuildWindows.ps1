Describe 'build-windows.ps1' {
  It 'requires an HTTPS AI assistant URL' {
    { & "$PSScriptRoot/build-windows.ps1" -PublicUrl 'http://example.com' -DryRun } | Should -Throw
  }
  It 'selects only the x86_64 MSVC target' {
    $result = & "$PSScriptRoot/build-windows.ps1" -PublicUrl 'https://ai.example.com' -DryRun
    $result | Should -Match 'x86_64-pc-windows-msvc'
    $result | Should -Not -Match 'aarch64-pc-windows'
  }
}
