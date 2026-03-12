#!/bin/bash
set -e

# Check for uncommitted changes
if ! git diff --quiet HEAD; then
  echo "Error: you have uncommitted changes. Commit or stash them first."
  exit 1
fi

# Auto-increment patch version
current=$(node -p "require('./package.json').version")
version=$(echo "$current" | awk -F. '{print $1"."$2"."$3+1}')

echo "$current → $version"

# Update version in package.json
npm version "$version" --no-git-tag-version > /dev/null

# Commit, tag, push
git add package.json package-lock.json
git commit -a -m "v$version"
git tag "v$version"
git push origin master
git push origin "v$version"

echo "Released v$version"
