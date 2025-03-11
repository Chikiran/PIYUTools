// Ensure all elements are loaded before adding event listeners
window.addEventListener('load', function() {
    // Theme handling
    const themeToggle = document.getElementById('themeToggle');
    
    // Load saved theme preference
    chrome.storage.sync.get(['darkMode'], function(result) {
        const isDarkMode = result.darkMode || false;
        document.body.className = isDarkMode ? 'dark' : 'light';
    });

    // Theme toggle
    themeToggle.addEventListener('click', function() {
        const isDarkMode = document.body.className === 'dark';
        const newMode = isDarkMode ? 'light' : 'dark';
        document.body.className = newMode;
        chrome.storage.sync.set({ darkMode: !isDarkMode });
    });

    // Tooltip click functionality
    const tooltipIcons = document.querySelectorAll('.tooltip-icon');
    let activeTooltip = null;

    // Close instructions when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tooltip-icon') && activeTooltip) {
            activeTooltip.classList.remove('active');
            const tooltipType = activeTooltip.getAttribute('data-tooltip');
            document.getElementById(tooltipType + 'Instructions').style.display = 'none';
            activeTooltip = null;
        }
    });

    tooltipIcons.forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent document click from immediately closing
            
            const tooltipType = icon.getAttribute('data-tooltip');
            const instructionsArea = document.getElementById(tooltipType + 'Instructions');
            
            // If clicking the same tooltip that's already active, close it
            if (activeTooltip === icon) {
                icon.classList.remove('active');
                instructionsArea.style.display = 'none';
                activeTooltip = null;
                return;
            }

            // Close any other active tooltip
            if (activeTooltip) {
                activeTooltip.classList.remove('active');
                const oldTooltipType = activeTooltip.getAttribute('data-tooltip');
                document.getElementById(oldTooltipType + 'Instructions').style.display = 'none';
            }

            // Show the clicked tooltip's instructions
            icon.classList.add('active');
            instructionsArea.style.display = 'block';
            activeTooltip = icon;
        });
    });

    // Extract Schedule button
    const extractButton = document.getElementById('extractButton');
    if (extractButton) {
        extractButton.addEventListener('click', function() {
            setLoading('extractButton', true);
            
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                chrome.tabs.sendMessage(tabs[0].id, {action: "extractSchedule"}, function(response) {
                    setLoading('extractButton', false);
                    
                    if (chrome.runtime.lastError) {
                        displayError("Error: Unable to extract schedule. Make sure you're on the correct page.");
                        return;
                    }
                });
            });
        });
    }

    // Schedinator button
    const schedinatorButton = document.getElementById('schedinatorButton');
    if (schedinatorButton) {
        schedinatorButton.addEventListener('click', function() {
            setLoading('schedinatorButton', true);
            
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                chrome.tabs.sendMessage(tabs[0].id, {action: "extractScheduleForSchedinator"}, function(response) {
                    setLoading('schedinatorButton', false);
                    
                    if (chrome.runtime.lastError) {
                        displayError("Error: Unable to extract schedule. Make sure you're on the correct page.");
                        return;
                    }

                    if (response.error) {
                        displayError(response.error);
                        return;
                    }

                    if (response.status === "completed" && response.data) {
                        const jsonString = JSON.stringify(response.data);
                        const encodedData = encodeURIComponent(jsonString);
                        const schedinatorUrl = `https://sched.chikiran.com/schedule?data=${encodedData}`;
                        
                        // Open Schedinator in a new tab
                        chrome.tabs.create({ url: schedinatorUrl });
                    }
                });
            });
        });
    }

    // Calculate GWA button
    const calculateGWAButton = document.getElementById('calculateGWAButton');
    if (calculateGWAButton) {
        calculateGWAButton.addEventListener('click', function() {
            setLoading('calculateGWAButton', true);
            
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                chrome.tabs.sendMessage(tabs[0].id, {action: "calculateGWA"}, function(response) {
                    setLoading('calculateGWAButton', false);
                    
                    if (chrome.runtime.lastError) {
                        displayError("Error: Make sure you're on the course card page");
                        return;
                    }
                    
                    if (response && response.midtermGWA && response.finalGWA) {
                        displayGWA(response.midtermGWA, response.finalGWA);
                    } else if (response && response.error) {
                        displayError(response.error);
                    }
                });
            });
        });
    }
});

// Ensure all elements are loaded before adding event listeners
window.addEventListener('load', function() {
    // GitHub button
    const githubButton = document.getElementById('githubButton');
    if (githubButton) {
        githubButton.addEventListener('click', function() {
            window.open('https://github.com/Chikiran/FEUT-Tools', '_blank');
        });
    }
});

function setLoading(buttonId, isLoading) {
    const button = document.getElementById(buttonId);
    if (isLoading) {
        button.classList.add('is-loading');
        button.disabled = true;
    } else {
        button.classList.remove('is-loading');
        button.disabled = false;
    }
}

function displayError(message) {
    const results = document.getElementById('results');
    results.innerHTML = `<p class="error-message">${message}</p>`;
}

function displayGWA(midterm, final) {
    const gwaContainer = document.querySelector('.gwa-container');
    const midtermElement = document.getElementById('midtermGWA');
    const finalElement = document.getElementById('finalGWA');
    
    gwaContainer.style.display = 'flex';
    midtermElement.textContent = parseFloat(midterm).toFixed(2);
    finalElement.textContent = parseFloat(final).toFixed(2);
}
