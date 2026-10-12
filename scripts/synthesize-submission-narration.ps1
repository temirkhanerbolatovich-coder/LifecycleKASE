param(
    [string]$Storyboard = "docs/submission/video-storyboard-2026-10-12.json",
    [string]$OutputDirectory = ".local-submission-media-20261012",
    [string]$Voice = "Microsoft Zira Desktop",
    [int]$Rate = 1
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$story = Get-Content -LiteralPath $Storyboard -Raw -Encoding UTF8 | ConvertFrom-Json
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$narrationDirectory = Join-Path $outputRoot "narration"
New-Item -ItemType Directory -Path $narrationDirectory -Force | Out-Null
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synthesizer.SelectVoice($Voice)
    $synthesizer.Rate = $Rate
    foreach ($video in $story.videos) {
        for ($sceneIndex = 0; $sceneIndex -lt $video.scenes.Count; $sceneIndex++) {
            $sentences = $video.scenes[$sceneIndex].sentences
            for ($sentenceIndex = 0; $sentenceIndex -lt $sentences.Count; $sentenceIndex++) {
                $name = "{0}-{1:D2}-{2:D2}.wav" -f $video.id, $sceneIndex, $sentenceIndex
                $synthesizer.SetOutputToWaveFile((Join-Path $narrationDirectory $name))
                $synthesizer.Speak([string]$sentences[$sentenceIndex])
                $synthesizer.SetOutputToNull()
            }
        }
    }
} finally {
    $synthesizer.Dispose()
}
Write-Output "Narration saved to $narrationDirectory using installed voice $Voice."
