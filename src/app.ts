// Importing and configuring required modules at the top
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { Anthropic } from '@anthropic-ai/sdk';

// Create output directory if it doesn't exist
const OUTPUT_DIR = 'output';
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
  console.log(`Created output directory: ${OUTPUT_DIR}`);
}

// Interface for repositories
interface Repository {
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  language: string;
  stargazers_count: number;
  topics: string[];
}

// Getting configuration from .env file or arguments
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || '';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';

// Checking if required variables are set
if (!GITHUB_TOKEN || !GITHUB_USERNAME || !CLAUDE_API_KEY) {
  console.error('You must set GITHUB_TOKEN, GITHUB_USERNAME, and CLAUDE_API_KEY');
  process.exit(1);
}

// Initializing Anthropic client
const anthropic = new Anthropic({
  apiKey: CLAUDE_API_KEY,
});

// Function to fetch all starred repositories
async function fetchStarredRepos(username: string): Promise<Repository[]> {
  let page = 1;
  const perPage = 100;
  let allRepos: Repository[] = [];
  let hasMoreRepos = true;

  console.log(`Fetching starred repositories for user ${username}...`);

  while (hasMoreRepos) {
    try {
      console.log(`Fetching page ${page}...`);
      
      const response = await axios.get(`https://api.github.com/users/${username}/starred`, {
        params: {
          page,
          per_page: perPage,
          sort: 'created',
          direction: 'desc'
        },
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
      });

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (response.data.length === 0) {
        hasMoreRepos = false;
        console.log('No more repositories to fetch.');
      } else {
        // Mapping response to required data
        const repos = response.data.map((repo: any) => ({
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description || '',
          html_url: repo.html_url,
          language: repo.language || 'Not specified',
          stargazers_count: repo.stargazers_count,
          topics: repo.topics || [],
        }));

        allRepos = [...allRepos, ...repos];
        console.log(`Fetched ${repos.length} repositories on page ${page}. Total: ${allRepos.length}`);
        
        // Check if we've reached the last page
        if (repos.length < perPage) {
          hasMoreRepos = false;
          console.log('Reached the last page of results.');
        } else {
          page++;
        }
      }
    } catch (error: any) {
      console.error(`Error while fetching repositories (page ${page}):`, error?.response?.status, error?.response?.statusText);
      
      // Check for rate limiting
      if (error?.response?.status === 403) {
        const resetTime = error?.response?.headers?.['x-ratelimit-reset'];
        if (resetTime) {
          const waitTime = Math.max(0, parseInt(resetTime) * 1000 - Date.now()) + 1000;
          console.log(`Rate limited. Waiting for ${Math.ceil(waitTime / 1000)} seconds before retrying...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          // Don't increment page, retry the same page
          continue;
        }
      } else if (error?.response?.status === 404) {
        console.error('User not found or no access to starred repositories.');
        hasMoreRepos = false;
      } else {
        // For other errors, pause and try again a few times before giving up
        if (page <= 3) {  // Only retry the first few pages
          console.log('Pausing for 5 seconds before retrying...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          // Don't increment page, retry the same page
          continue;
        } else {
          console.error('Too many errors, stopping pagination.');
          hasMoreRepos = false;
        }
      }
    }
  }

  return allRepos;
}

// Function to save file to output directory
function saveToOutputDir(filename: string, content: string | Buffer): void {
  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, content);
  console.log(`Saved to file ${filePath}`);
}

// Function to save repositories to JSON file
function saveReposToJson(repos: Repository[], filename: string): void {
  saveToOutputDir(filename, JSON.stringify(repos, null, 2));
  console.log(`Saved ${repos.length} repositories to file ${path.join(OUTPUT_DIR, filename)}`);
}

// Function to chunk repositories for Claude (to handle large numbers of repos)
function chunkRepositoriesForClaude(repos: Repository[]): Repository[][] {
  // Split repositories into chunks of 100 or fewer
  const chunkSize = 100;
  const chunks: Repository[][] = [];
  
  for (let i = 0; i < repos.length; i += chunkSize) {
    chunks.push(repos.slice(i, i + chunkSize));
  }
  
  console.log(`Split ${repos.length} repositories into ${chunks.length} chunks for Claude processing`);
  return chunks;
}

// Function to prepare prompt for Claude
function preparePromptForClaude(repos: Repository[], isFirstChunk: boolean = true, previousCategories: Category[] = []): string {
  let prompt = isFirstChunk 
    ? "Here's a list of GitHub repositories I've starred. Based on their names, descriptions, and topics, please suggest how to divide them into meaningful lists or categories that I could create on GitHub:\n\n"
    : "Here's another batch of GitHub repositories I've starred. Please categorize them using the categories you've already identified, and create new categories if necessary:\n\n";
  
  // Add the existing categories if this isn't the first chunk
  if (!isFirstChunk && previousCategories.length > 0) {
    prompt += "Here are the categories you've already identified:\n\n";
    previousCategories.forEach(category => {
      prompt += `- ${category.name}: ${category.description}\n`;
    });
    prompt += "\n";
  }
  
  // Add the repositories for this chunk
  repos.forEach((repo, index) => {
    prompt += `${index + 1}. ${repo.full_name}\n`;
    if (repo.description) {
      prompt += `   Description: ${repo.description}\n`;
    }
    if (repo.language) {
      prompt += `   Language: ${repo.language}\n`;
    }
    if (repo.topics && repo.topics.length > 0) {
      prompt += `   Topics: ${repo.topics.join(', ')}\n`;
    }
    prompt += '\n';
  });
  
  prompt += "Please provide your response in a structured JSON format with the following structure:\n";
  prompt += "{\n";
  prompt += '  "categories": [\n';
  prompt += "    {\n";
  prompt += '      "name": "Category Name",\n';
  prompt += '      "description": "Brief description of why this category makes sense",\n';
  prompt += '      "repositories": [\n';
  prompt += '        {"full_name": "owner/repo_name", "reason": "Why this repo belongs in this category"}\n';
  prompt += "      ]\n";
  prompt += "    }\n";
  prompt += "  ]\n";
  prompt += "}";
  
  return prompt;
}

// Interface for Claude's response
interface CategoryRepositoryMapping {
  full_name: string;
  reason: string;
}

interface Category {
  name: string;
  description: string;
  repositories: CategoryRepositoryMapping[];
}

interface ClaudeResponse {
  categories: Category[];
}

// Function to send prompt to Claude and parse JSON response
async function askClaude(prompt: string): Promise<ClaudeResponse> {
  try {
    console.log('Sending data to Claude...');
    
    const msg = await anthropic.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
    });
    
    // Extract JSON from Claude's response
    const responseText = msg.content[0].text;
    
    try {
      // Look for JSON structure in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        return JSON.parse(jsonStr) as ClaudeResponse;
      } else {
        console.error("Could not find JSON in Claude's response");
        return { categories: [] };
      }
    } catch (parseError) {
      console.error("Failed to parse JSON from Claude's response:", parseError);
      console.log("Raw response:", responseText);
      return { categories: [] };
    }
  } catch (error) {
    console.error('Error while communicating with Claude:', error);
    return { categories: [] };
  }
}

// Main function
async function main() {
  try {
    // Fetching repositories
    const repos = await fetchStarredRepos(GITHUB_USERNAME);
    console.log(`Fetched a total of ${repos.length} repositories.`);
    
    if (repos.length === 0) {
      console.error('No repositories fetched. Please check your GitHub token and username.');
      process.exit(1);
    }
    
    // Saving to JSON file
    saveReposToJson(repos, 'starred-repos.json');
    
    // Split repositories into chunks for Claude (to handle token limits)
    const repoChunks = chunkRepositoriesForClaude(repos);
    let allCategories: Category[] = [];
    
    // Process each chunk with Claude
    for (let i = 0; i < repoChunks.length; i++) {
      const chunk = repoChunks[i];
      console.log(`\nProcessing chunk ${i + 1} of ${repoChunks.length} (${chunk.length} repositories)...`);
      
      // Prepare prompt for this chunk
      const isFirstChunk = i === 0;
      const prompt = preparePromptForClaude(chunk, isFirstChunk, allCategories);
      
      // Save prompt to file (with chunk number)
      saveToOutputDir(`claude-prompt-chunk${i + 1}.txt`, prompt);
      
      // Send to Claude
      console.log(`Sending chunk ${i + 1} to Claude...`);
      const chunkResponse = await askClaude(prompt);
      
      // Save this chunk's response
      saveToOutputDir(`claude-response-chunk${i + 1}.json`, JSON.stringify(chunkResponse, null, 2));
      
      // Merge categories
      if (chunkResponse.categories && chunkResponse.categories.length > 0) {
        if (isFirstChunk) {
          // For the first chunk, just use all categories
          allCategories = chunkResponse.categories;
        } else {
          // For subsequent chunks, merge with existing categories
          chunkResponse.categories.forEach(newCategory => {
            // Check if this category already exists
            const existingCategoryIndex = allCategories.findIndex(
              cat => cat.name.toLowerCase() === newCategory.name.toLowerCase()
            );
            
            if (existingCategoryIndex >= 0) {
              // Merge repositories into existing category
              const existingRepos = new Set(allCategories[existingCategoryIndex].repositories.map(r => r.full_name));
              
              // Add only new repositories
              newCategory.repositories.forEach(repo => {
                if (!existingRepos.has(repo.full_name)) {
                  allCategories[existingCategoryIndex].repositories.push(repo);
                }
              });
            } else {
              // Add new category
              allCategories.push(newCategory);
            }
          });
        }
      }
      
      // Add a delay between Claude API calls to avoid rate limiting
      if (i < repoChunks.length - 1) {
        console.log('Waiting 5 seconds before processing next chunk...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    // Save final merged results
    const finalResponse: ClaudeResponse = { categories: allCategories };
    saveToOutputDir('claude-response-final.json', JSON.stringify(finalResponse, null, 2));
    console.log('\nSaved final merged categories to output/claude-response-final.json');
    
    // Generate HTML view with all repositories
    generateHtmlView(finalResponse, repos);
    
    // Print summary of categories
    if (finalResponse.categories && finalResponse.categories.length > 0) {
      console.log('\nSuggested Categories:');
      finalResponse.categories.forEach(category => {
        console.log(`- ${category.name} (${category.repositories.length} repositories)`);
      });
      
      // Check if any repositories were missed
      const categorizedRepos = new Set<string>();
      finalResponse.categories.forEach(category => {
        category.repositories.forEach(repo => {
          categorizedRepos.add(repo.full_name);
        });
      });
      
      const missedRepos = repos.filter(repo => !categorizedRepos.has(repo.full_name));
      if (missedRepos.length > 0) {
        console.log(`\n⚠️ Warning: ${missedRepos.length} repositories were not categorized.`);
        saveToOutputDir('uncategorized-repos.json', JSON.stringify(missedRepos, null, 2));
        console.log('Saved uncategorized repositories to output/uncategorized-repos.json');
      } else {
        console.log('\n✅ All repositories were successfully categorized!');
      }
    } else {
      console.log('No categories were suggested by Claude.');
    }
    
  } catch (error) {
    console.error('An error occurred while executing the script:', error);
  }
}

// Function to generate HTML view for better visualization
function generateHtmlView(response: ClaudeResponse, repos: Repository[]): void {
  try {
    // Create a map of repositories for quick lookup
    const repoMap = new Map<string, Repository>();
    repos.forEach(repo => {
      repoMap.set(repo.full_name, repo);
    });
    
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>GitHub Stars Categories</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        h1 { color: #24292e; }
        .category { margin-bottom: 30px; border: 1px solid #e1e4e8; border-radius: 6px; padding: 15px; }
        .category h2 { margin-top: 0; border-bottom: 1px solid #e1e4e8; padding-bottom: 10px; }
        .category-description { color: #586069; margin-bottom: 15px; }
        .repo-item { margin-bottom: 15px; padding: 10px; border: 1px solid #e1e4e8; border-radius: 6px; }
        .repo-name { font-weight: bold; margin-bottom: 5px; }
        .repo-name a { color: #0366d6; text-decoration: none; }
        .repo-name a:hover { text-decoration: underline; }
        .repo-description { color: #586069; margin-bottom: 5px; }
        .repo-reason { font-style: italic; color: #6a737d; }
        .repo-meta { margin-top: 8px; font-size: 0.9em; color: #6a737d; }
        .repo-language { margin-right: 10px; }
        .topics-list { display: flex; flex-wrap: wrap; gap: 5px; }
        .topic { background-color: #f1f8ff; color: #0366d6; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
      </style>
    </head>
    <body>
      <h1>GitHub Stars Categories</h1>
      <p>Total repositories: ${repos.length}</p>
    `;
    
    response.categories.forEach(category => {
      html += `
      <div class="category">
        <h2>${category.name}</h2>
        <div class="category-description">${category.description}</div>
        <div class="repository-list">
      `;
      
      category.repositories.forEach(repo => {
        const repoDetails = repoMap.get(repo.full_name);
        
        html += `
        <div class="repo-item">
          <div class="repo-name"><a href="${repoDetails?.html_url || '#'}" target="_blank">${repo.full_name}</a></div>
        `;
        
        if (repoDetails?.description) {
          html += `<div class="repo-description">${repoDetails.description}</div>`;
        }
        
        html += `<div class="repo-reason">Reason: ${repo.reason}</div>`;
        
        html += `<div class="repo-meta">`;
        if (repoDetails?.language) {
          html += `<span class="repo-language">Language: ${repoDetails.language}</span>`;
        }
        
        if (repoDetails?.topics && repoDetails.topics.length > 0) {
          html += `<div class="topics-list">`;
          repoDetails.topics.forEach(topic => {
            html += `<span class="topic">${topic}</span>`;
          });
          html += `</div>`;
        }
        
        html += `</div></div>`;
      });
      
      html += `</div></div>`;
    });
    
    html += `</body></html>`;
    
    saveToOutputDir('categorized-repos.html', html);
    console.log('Generated HTML view of categories at output/categorized-repos.html');
  } catch (error) {
    console.error('Error generating HTML view:', error);
  }
}

// Running the script
main();