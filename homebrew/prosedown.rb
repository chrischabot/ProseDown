# Homebrew Cask template for ProseDown.
#
# On each release, copy this file to the tap repo
# (github.com/chrischabot/homebrew-prosedown, under Casks/prosedown.rb),
# filling in `version` and `sha256` from release.sh's output.
#
# Users then install with:
#     brew tap chrischabot/prosedown
#     brew install --cask prosedown
cask "prosedown" do
  version "0.1.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/chrischabot/ProseDown/releases/download/v#{version}/ProseDown.dmg"
  name "ProseDown"
  desc "Fast native markdown viewer for macOS"
  homepage "https://github.com/chrischabot/ProseDown"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :tahoe"

  app "ProseDown.app"

  zap trash: [
    "~/Library/Application Support/ProseDown",
    "~/Library/Caches/app.prosedown",
    "~/Library/Preferences/app.prosedown.plist",
    "~/Library/Saved Application State/app.prosedown.savedState",
  ]
end
