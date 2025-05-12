function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function extractSchedule() {
    try {
        const rows = document.querySelectorAll('.assessment_schedule tbody tr');
        if (rows.length === 0) {
            return { error: "Error: No schedule data found." };
        }

        const csvData = [];
        
        const headers = Array.from(document.querySelectorAll('.assessment_schedule thead th'))
            .map(th => th.innerText.trim().replace(/,/g, ' '));
        csvData.push(headers.join(','));

        rows.forEach(row => {
            const cols = row.querySelectorAll('td');
            const rowData = Array.from(cols).map(col => col.innerText.trim().replace(/,/g, ' '));
            if (rowData.length > 0) {
                csvData.push(rowData.join(','));
            }
        });

        const csv = csvData.join('\n');
        downloadCSV(csv, `schedule.csv`); 

        if (csvData.length === 1) { // If only headers, no data
            return { error: "Error: No valid schedule data extracted." };
        }

        chrome.runtime.sendMessage({ action: "scheduleData", data: csvData });

        console.log("Schedule data extracted and sent to popup:", csvData);
        return { status: "completed", data: csvData };
    } catch (error) {
        console.error("Error extracting schedule data:", error);
        return { error: "Error: Failed to extract schedule data." };
    }
}

function extractScheduleForSchedinator() {
    try {
        const rows = document.querySelectorAll('.assessment_schedule tbody tr');
        if (rows.length === 0) {
            return { error: "Error: No schedule data found." };
        }

        // Get the data in CSV format similar to what the site expects
        const entries = [];
        const uniqueDays = new Set();
        let earliestTime = null;
        let latestTime = null;

        // Process each row
        rows.forEach((row, rowIndex) => {
            try {
                const cols = row.querySelectorAll('td');
                if (cols.length >= 6) {
                    const courseData = {
                        Courses: cols[0].innerText.trim(),
                        Title: cols[1].innerText.trim().replace(/,/g, ' '),
                        Section: cols[2].innerText.trim(),
                        Units: cols[3].innerText.trim(),
                        Days: cols[4].innerText.trim(),
                        Time: cols[5].innerText.trim(),
                        Room: cols[6] ? cols[6].innerText.trim() : 'TBA'
                    };

                    // Skip if it's a total units row
                    if (courseData.Title.toUpperCase().startsWith('TOTAL UNITS')) {
                        return;
                    }

                    // Split multiple days and times
                    const days = courseData.Days.split('/').map(d => d.trim()).filter(Boolean);
                    const times = courseData.Time.split('/').map(t => {
                        // Ensure time is in HH:mm:ss format
                        const [start, end] = t.trim().split('-').map(time => {
                            const [hours, minutes] = time.trim().split(':');
                            return `${hours.padStart(2, '0')}:${minutes || '00'}:00`;
                        });
                        return `${start}-${end}`;
                    }).filter(Boolean);
                    const rooms = courseData.Room.split('/').map(r => r.trim()).filter(Boolean);

                    if (days.length === 0 || times.length === 0) {
                        console.warn('Skipping row with empty days or times:', courseData);
                        return;
                    }

                    // Process each day-time-room combination
                    days.forEach((day, index) => {
                        const time = times[index] || times[0];
                        const room = rooms[index] || rooms[0];

                        try {
                            // Parse time
                            const [startStr, endStr] = time.split('-');
                            const baseDate = new Date();
                            const start = new Date(`${baseDate.toDateString()} ${startStr}`);
                            const end = new Date(`${baseDate.toDateString()} ${endStr}`);
                            const duration = (end.getTime() - start.getTime()) / (1000 * 60);

                            if (duration <= 0) {
                                console.warn(`Skipping invalid duration for entry: ${courseData.Courses} - ${time}`);
                                return;
                            }

                            // Update earliest and latest times
                            if (!earliestTime || start < earliestTime) earliestTime = start;
                            if (!latestTime || end > latestTime) latestTime = end;

                            // Add day to unique days set
                            uniqueDays.add(day);

                            // Create schedule entry
                            entries.push({
                                courseCode: courseData.Courses,
                                title: courseData.Title,
                                section: courseData.Section,
                                units: parseFloat(courseData.Units) || 0,
                                day,
                                startTime: start.toISOString(),
                                endTime: end.toISOString(),
                                duration,
                                room
                            });
                        } catch (timeError) {
                            console.error(`Error processing time for row ${rowIndex}:`, { time, error: timeError });
                        }
                    });
                }
            } catch (rowError) {
                console.error(`Error processing row ${rowIndex}:`, rowError);
            }
        });

        if (entries.length === 0) {
            return { error: "No valid schedule entries could be processed." };
        }

        // Sort days in the correct order
        const dayOrder = ['M', 'T', 'W', 'TH', 'F', 'S', 'U'];
        const sortedDays = Array.from(uniqueDays)
            .filter(day => entries.some(entry => entry.day === day))
            .sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));

        // Generate time slots every 30 minutes
        const timeSlots = [];
        if (earliestTime && latestTime) {
            let currentSlot = new Date(earliestTime);
            while (currentSlot <= latestTime) {
                timeSlots.push(currentSlot.toISOString());
                currentSlot = new Date(currentSlot.getTime() + 30 * 60000);
            }
        }

        const scheduleData = {
            entries,
            metadata: {
                days: sortedDays,
                startTime: earliestTime?.toISOString(),
                endTime: latestTime?.toISOString(),
                timeSlots
            }
        };

        console.log('Final processed data:', scheduleData);
        return { status: "completed", data: scheduleData };
    } catch (error) {
        console.error("Error extracting schedule data for Schedinator:", error);
        return { error: "Error: Failed to extract schedule data - " + error.message };
    }
}

// Calculate GWA
function calculateGWA() {
    try {
        const table = document.querySelector('.table');
        const rows = table.querySelectorAll('tbody tr');
        let totalUnitsMidterm = 0;
        let totalWeightedMidterm = 0;
        let totalUnitsFinal = 0;
        let totalWeightedFinal = 0;

        // Special grade messages
        const specialGrades = {
            '9.5': 'Pending Balance',
            '9.0': 'Incomplete',
            '8.0': 'Credited',
            '7.0': 'Dropped',
            '0.0': 'Excessive Absences'
        };

        // Add CSS for custom tooltip if not already added
        if (!document.getElementById('tooltip-styles')) {
            const styleSheet = document.createElement('style');
            styleSheet.id = 'tooltip-styles';
            styleSheet.textContent = `
                .special-grade {
                    position: relative;
                    color: #ff0000 !important;
                    font-weight: bold;
                    background-color: #fff0f0;
                    border-radius: 4px;
                    padding: 2px 4px;
                    cursor: pointer;
                }
                .special-grade:hover::after {
                    content: attr(data-tooltip);
                    position: absolute;
                    left: 50%;
                    transform: translateX(-50%);
                    bottom: 100%;
                    margin-bottom: 5px;
                    background-color: #333;
                    color: white;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 14px;
                    white-space: nowrap;
                    z-index: 1000;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
                .special-grade:hover::before {
                    content: '';
                    position: absolute;
                    left: 50%;
                    transform: translateX(-50%);
                    bottom: 100%;
                    border: 6px solid transparent;
                    border-top-color: #333;
                    margin-bottom: -6px;
                    z-index: 1000;
                }
            `;
            document.head.appendChild(styleSheet);
        }

        // Process each row except the last one if it's already a GWA row
        rows.forEach(row => {
            // Skip if GWA row
            if (row.classList.contains('gwa-row')) {
                return;
            }

            if (row.cells && row.cells.length >= 6) {
                const units = parseFloat(row.cells[3].innerText);
                const midtermCell = row.cells[4];
                const finalCell = row.cells[5];
                const midtermGradeText = midtermCell.innerText.trim();
                const finalGradeText = finalCell.innerText.trim();

                // Midterm Grade
                if (specialGrades.hasOwnProperty(midtermGradeText)) {
                    // Style 
                    midtermCell.className = 'special-grade';
                    midtermCell.setAttribute('data-tooltip', specialGrades[midtermGradeText]);
                    // Don't include in GWA calculation
                } else {
                    const midtermGrade = parseFloat(midtermGradeText);
                    if (!isNaN(units) && !isNaN(midtermGrade) && midtermGrade >= 0 && midtermGrade <= 4.0) {
                        totalUnitsMidterm += units;
                        totalWeightedMidterm += units * midtermGrade;
                    }
                }

                // Final Grade
                if (specialGrades.hasOwnProperty(finalGradeText)) {
                    // Style 
                    finalCell.className = 'special-grade';
                    finalCell.setAttribute('data-tooltip', specialGrades[finalGradeText]);
                    // Don't include in GWA calculation
                } else {
                    const finalGrade = parseFloat(finalGradeText);
                    if (!isNaN(units) && !isNaN(finalGrade) && finalGrade >= 0 && finalGrade <= 4.0) {
                        totalUnitsFinal += units;
                        totalWeightedFinal += units * finalGrade;
                    }
                }
            }
        });

        // Calculate GWA
        const midtermGWA = (totalWeightedMidterm / totalUnitsMidterm).toFixed(2);
        const finalGWA = (totalWeightedFinal / totalUnitsFinal).toFixed(2);

        // Remove existing GWA row if it exists
        const existingGWARow = table.querySelector('.gwa-row');
        if (existingGWARow) {
            existingGWARow.remove();
        }

        // Create and insert GWA row at the end of le table
        const gwaRow = document.createElement('tr');
        gwaRow.className = 'gwa-row';
        gwaRow.style.backgroundColor = '#f3f4f6';
        gwaRow.style.fontWeight = 'bold';
        gwaRow.innerHTML = `
            <td colspan="3" style="text-align: right; padding: 8px;">General Weighted Average (GWA):</td>
            <td style="text-align: center; padding: 8px;">${totalUnitsMidterm}</td>
            <td style="text-align: center; padding: 8px;">${midtermGWA}</td>
            <td style="text-align: center; padding: 8px;">${finalGWA}</td>
        `;

        const tbody = table.querySelector('tbody');
        tbody.appendChild(gwaRow);

        return { 
            midtermGWA: midtermGWA.toString(), 
            finalGWA: finalGWA.toString() 
        };
    } catch (error) {
        console.error('Error calculating GWA:', error);
        return { error: 'Failed to calculate GWA' };
    }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.action === "extractSchedule") {
            const scheduleData = extractSchedule();
            sendResponse({ status: "completed", scheduleData });
        } 
        else if (request.action === "calculateGWA") {
            const result = calculateGWA();
            sendResponse(result);
        }
        else if (request.action === "extractScheduleForSchedinator") {
            const result = extractScheduleForSchedinator();
            sendResponse(result);
        }
        return true;
    }
);
