-- Create Students table
CREATE TABLE Students (
    student_id INT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    age INT,
    enrollment_year INT
);

-- Create table
CREATE TABLE Professors (
    professor_id INT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    department VARCHAR(100) NOT NULL
);

-- Create table
CREATE TABLE Courses (
    course_id INT PRIMARY KEY,
    course_name VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    credits INT CHECK (credits > 0)
);

-- Create Teachings table
CREATE TABLE Teachings (
    teaching_id INT PRIMARY KEY,
    professor_id INT NOT NULL,
    course_id INT NOT NULL,
    semester VARCHAR(20) NOT NULL,
    year INT NOT NULL,
    
    CONSTRAINT fk_professor
        FOREIGN KEY (professor_id)
        REFERENCES Professors(professor_id)
        ON DELETE CASCADE,
        
    CONSTRAINT fk_course
        FOREIGN KEY (course_id)
        REFERENCES Courses(course_id)
        ON DELETE CASCADE
);

-- Create Enrollments table
CREATE TABLE Enrollments (
    enrollment_id INT PRIMARY KEY,
    student_id INT NOT NULL,
    teaching_id INT NOT NULL,
    grade VARCHAR(10),  -- allows '90', 'DNE', or NULL

    CONSTRAINT fk_student
        FOREIGN KEY (student_id)
        REFERENCES Students(student_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_teaching
        FOREIGN KEY (teaching_id)
        REFERENCES Teachings(teaching_id)
        ON DELETE CASCADE
);


-- Insert Students data
INSERT INTO Students (student_id, first_name, last_name, email, age, enrollment_year) VALUES
(1, 'Alice', 'Brown', 'alice.brown@email.com', 20, 2023),
(2, 'Bob', 'Smith', 'bob.smith@email.com', 22, 2022),
(3, 'Charlie', 'Johnson', 'charlie.j@email.com', 21, 2023),
(4, 'Diana', 'Lee', 'diana.lee@email.com', 23, 2021),
(5, 'Ethan', 'Moore', 'ethan.moore@email.com', 24, 2021),
(6, 'Fiona', 'Davis', 'fiona.d@email.com', 19, 2024),
(7, 'George', 'White', 'george.w@email.com', 21, 2023),
(8, 'Hannah', 'Kim', 'hannah.k@email.com', 22, 2022);

-- Insert Professors data
INSERT INTO Professors (professor_id, first_name, last_name, email, department) VALUES
(1, 'John', 'Miller', 'john.miller@university.edu', 'Computer Science'),
(2, 'Sarah', 'Wilson', 'sarah.wilson@university.edu', 'Computer Science'),
(3, 'Emily', 'Clark', 'emily.clark@university.edu', 'Software Engineering'),
(4, 'David', 'Nguyen', 'david.nguyen@university.edu', 'Computer Science'),
(5, 'Laura', 'Perez', 'laura.perez@university.edu', 'Information Systems'),
(6, 'Michael', 'Chen', 'michael.chen@university.edu', 'Computer Science');

-- Insert Courses data
INSERT INTO Courses (course_id, course_name, department, credits) VALUES
(101, 'Database Systems', 'Computer Science', 3),
(102, 'Software Engineering', 'Software Engineering', 4),
(103, 'Data Structures', 'Computer Science', 3),
(104, 'Operating Systems', 'Computer Science', 4),
(105, 'Web Development', 'Software Engineering', 3),
(106, 'Information Security', 'Information Systems', 3),
(107, 'Information retrieval', 'Information Systems', 3),
(108, 'Machine Learning', 'Computer Science', 4);

-- Insert Teachings data
INSERT INTO Teachings (teaching_id, professor_id, course_id, semester, year) VALUES
(1, 1, 101, 'Fall', 2024),
(2, 2, 102, 'Fall', 2024),
(3, 1, 103, 'Winter', 2025),
(4, 3, 105, 'Fall', 2024),
(5, 4, 104, 'Winter', 2025),
(6, 5, 106, 'Fall', 2024),
(7, 5, 106, 'Winter', 2024),
(8, 6, 107, 'Winter', 2025),
(9, 6, 107, 'Fall', 2025),
(10, 2, 101, 'Winter', 2025),
(11, 1, 101, 'Winter', 2024),
(12, 2, 104, 'Winter', 2025);



-- Insert Enrollments data
INSERT INTO Enrollments (enrollment_id, student_id, teaching_id, grade) VALUES
(1, 1, 1, '90'),
(2, 1, 2, '75'),
(3, 2, 1, '72'),
(4, 3, 3, '85'),
(5, 4, 2, '83'),
(6, 5, 4, '62'),
(7, 6, 1, '95'),
(8, 7, 5, 'DNE'),
(9, 8, 6, NULL),     -- real SQL NULL (not the string "Null")
(10, 2, 7, '81'),
(11, 2, 6, '92'),
(12, 4, 4, '65'),
(13, 4, 12, '81'),
(14, 5, 10, '92'),
(15, 6, 11, '65');

